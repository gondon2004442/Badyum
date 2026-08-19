import { SignedValues } from "@badyum/core";
import { Users, type User } from "./users.ts";
import type { Env } from "./env.ts";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

const SESSION_COOKIE = "badyum_session";
/** Месяц. Человек не должен логиниться каждый раз, чтобы просто поговорить. */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Переход к Google и обратно — дело секунд; больше жить состоянию незачем. */
const STATE_TTL_SECONDS = 600;

interface SessionPayload {
  userId: string;
}

interface StatePayload {
  /** Куда вернуть человека: он мог начать вход, стоя в канале. */
  back: string;
}

/**
 * Куда Google возвращает после согласия.
 *
 * Считаем от адреса запроса, а не берём из настроек: сервис живёт и на
 * workers.dev, и на своём домене, и захардкоженный адрес сломал бы один из них.
 * В консоли Google оба надо перечислить как разрешённые.
 */
const redirectUri = (url: URL) => `${url.origin}/api/auth/google/callback`;

/**
 * Сессионная кука.
 *
 * `SameSite=None` — не послабление, а необходимость. Десктопное приложение
 * показывает страницу из своих файлов, её origin `tauri://localhost`, и для
 * браузера обращение к badyum.ru оттуда межсайтовое. С `Lax` кука на такие
 * запросы не уходит вовсе: человек, вошедший через Google, оставался бы для
 * сервера гостем, и завести канал из приложения было нельзя.
 *
 * То, что `Lax` давал даром — защиту от подделки запроса с чужого сайта, —
 * теперь делается руками: `forged` в cors.ts отбивает всё, что меняет
 * состояние и пришло с незнакомого origin. Прочитать ответ чужой сайт не
 * сможет в любом случае: разрешение мы выдаём поимённо.
 *
 * `Secure` обязателен: с `SameSite=None` браузер иначе куку просто не примет.
 */
const cookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Внутренний адрес для возврата.
 *
 * Только путь внутри сервиса: без проверки параметр `back` превращается в
 * открытый редирект — ссылка на наш домен, уводящая на чужой сайт после входа.
 */
function safeBack(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export class Auth {
  private readonly signer: SignedValues;
  readonly users: Users;

  constructor(private readonly env: Env) {
    this.signer = new SignedValues(env.BADYUM_TOKEN_SECRET);
    this.users = new Users(env.DB);
  }

  configured(): boolean {
    return Boolean(env(this.env).id && env(this.env).secret);
  }

  /** Начало входа: уводим к Google. */
  async start(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!this.configured()) {
      return new Response("вход через Google не настроен", { status: 501 });
    }

    const state = await this.signer.sign<StatePayload>(
      { back: safeBack(url.searchParams.get("back")) },
      STATE_TTL_SECONDS,
    );

    const to = new URL(GOOGLE_AUTH);
    to.searchParams.set("client_id", env(this.env).id);
    to.searchParams.set("redirect_uri", redirectUri(url));
    to.searchParams.set("response_type", "code");
    to.searchParams.set("scope", "openid profile");
    to.searchParams.set("state", state);
    // Подписанное состояние — оно же защита от CSRF: чужой запрос на callback
    // не сможет предъявить значение с нашей подписью.

    return Response.redirect(to.toString(), 302);
  }

  /** Возврат от Google: меняем код на профиль и заводим сессию. */
  async callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");

    if (!code || !rawState) return Response.redirect(`${url.origin}/?auth=failed`, 302);

    const state = await this.signer.verify<StatePayload>(rawState);
    if (!state) return Response.redirect(`${url.origin}/?auth=expired`, 302);

    const profile = await this.exchange(code, redirectUri(url));
    if (!profile) return Response.redirect(`${url.origin}/?auth=failed`, 302);

    const user = await this.users.upsertFromGoogle(profile);
    const session = await this.signer.sign<SessionPayload>(
      { userId: user.id },
      SESSION_TTL_SECONDS,
    );

    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}${safeBack(state.back)}`,
        "set-cookie": cookie(session, SESSION_TTL_SECONDS),
      },
    });
  }

  /**
   * Код на профиль.
   *
   * Подпись id_token не проверяем намеренно: он получен прямым запросом к
   * Google по TLS, а не принесён клиентом. Сам Google документирует этот случай
   * как не требующий проверки — проверять надо то, что пришло через браузер.
   */
  private async exchange(
    code: string,
    redirect: string,
  ): Promise<{ sub: string; name: string; picture: string | null } | null> {
    try {
      const response = await fetch(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env(this.env).id,
          client_secret: env(this.env).secret,
          redirect_uri: redirect,
          grant_type: "authorization_code",
        }),
      });
      if (!response.ok) {
        console.warn(`Google вернул ${response.status} при обмене кода`);
        return null;
      }

      const body = (await response.json()) as { id_token?: string };
      if (!body.id_token) return null;

      const payload = body.id_token.split(".")[1];
      if (!payload) return null;

      const claims = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(
            atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          ),
        ),
      ) as { sub?: string; name?: string; picture?: string };

      if (!claims.sub) return null;
      return {
        sub: claims.sub,
        name: claims.name ?? "гость",
        picture: claims.picture ?? null,
      };
    } catch (err) {
      console.warn(`обмен кода не удался: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Кто пришёл. null — гость, и это нормальный режим работы. */
  async current(request: Request): Promise<User | null> {
    const raw = readCookie(request, SESSION_COOKIE);
    if (!raw) return null;

    const session = await this.signer.verify<SessionPayload>(raw);
    if (!session?.userId) return null;

    return this.users.byId(session.userId);
  }

  logout(): Response {
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": cookie("", 0) },
    });
  }
}

const env = (e: Env) => ({
  id: e.BADYUM_GOOGLE_CLIENT_ID ?? "",
  secret: e.BADYUM_GOOGLE_CLIENT_SECRET ?? "",
});
