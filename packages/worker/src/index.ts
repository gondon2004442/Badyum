import { z } from "zod";
import { identityIdSchema } from "@badyum/shared";
import { newUserId, normalizeDisplayName, TokenSigner } from "@badyum/core";
import { Registry } from "./Registry.ts";
import { ChannelRoom } from "./ChannelRoom.ts";
import { Auth } from "./auth.ts";
import type { Env } from "./env.ts";

export { Registry, ChannelRoom };

/**
 * Каталог один на весь сервис, поэтому и имя у него одно фиксированное. Будь
 * имён несколько, инвайт-код перестал бы быть уникальным, и двое по одной
 * ссылке могли бы попасть в разные каналы.
 */
const registryOf = (env: Env) => env.REGISTRY.get(env.REGISTRY.idFromName("global"));

/** Комната именуется channelId — объект сам знает, какой канал обслуживает. */
const roomOf = (env: Env, channelId: string) =>
  env.ROOMS.get(env.ROOMS.idFromName(channelId));

const createChannelSchema = z.object({
  name: z.string().min(1).max(64),
  slug: z.string().max(64).optional(),
});

const joinBodySchema = z
  .object({
    displayName: z.string().min(1).max(64),
    identityId: identityIdSchema.optional(),
    code: z.string().max(200).optional(),
    slug: z.string().max(200).optional(),
    channelId: z.string().max(200).optional(),
  })
  .refine((b) => b.code !== undefined || b.slug !== undefined || b.channelId !== undefined, {
    message: "нужен code, slug или channelId",
  });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Кто отвечает за созданный канал.
 *
 * `null` — создавать нельзя. Право даёт вход: без него запрет ничего бы не
 * стоил, потому что канал в каталоге стоит одного запроса, а адресов у того,
 * кто это делает нарочно, сколько угодно.
 *
 * Там, где вход не настроен вовсе (локальная разработка, чужая копия сервиса),
 * требовать его нельзя — иначе завести канал в такой копии было бы нечем.
 * Тогда, как раньше, считаем по адресу: CF-Connecting-IP ставит сам Cloudflare
 * и подделать его клиент не может, а пустая строка — общее ведро, потому что
 * один общий лимит лучше, чем ни одного.
 */
async function creatorOf(request: Request, auth: Auth): Promise<string | null> {
  const user = await auth.current(request);
  if (user) return `u:${user.id}`;
  if (auth.configured()) return null;
  return `ip:${request.headers.get("cf-connecting-ip") ?? ""}`;
}

/** HTTP-код по причине отказа: клиент по нему решает, предлагать ли вход. */
const statusFor = (error: string): number =>
  error === "auth_required" ? 401 : error === "too_many" ? 429 : 404;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    /**
     * Сигналинг. Соединение уходит в объект канала целиком — Worker его не
     * держит и в разговоре не участвует.
     *
     * Канал берём из токена, а не из адреса: иначе можно было бы предъявить
     * токен от своего канала, а подключиться к чужому. Сам объект тоже сверяет
     * channelId в токене со своим именем — проверка стоит копейки, а без неё
     * ошибка здесь молча открывала бы чужую комнату.
     */
    if (path === "/ws") {
      const token = url.searchParams.get("token");
      if (!token) return new Response("нужен token", { status: 400 });

      const claims = await new TokenSigner(env.BADYUM_TOKEN_SECRET).verify(token);
      if (!claims) return new Response("токен недействителен", { status: 401 });

      return roomOf(env, claims.channelId).fetch(request);
    }

    /**
     * Аккаунты.
     *
     * Всё здесь необязательно: гость по-прежнему заходит по ссылке, введя одно
     * имя, и ни один из этих маршрутов ему не нужен. Аккаунт добавляет
     * постоянный ник, а не право говорить.
     */
    if (path === "/api/auth/google") return new Auth(env).start(request);
    if (path === "/api/auth/google/callback") return new Auth(env).callback(request);
    if (path === "/api/auth/logout" && request.method === "POST") {
      return new Auth(env).logout();
    }

    if (path === "/api/me") {
      const auth = new Auth(env);
      const user = await auth.current(request);
      return json({
        user: user
          ? {
              id: user.id,
              nick: user.nick,
              tag: user.tag,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            }
          : null,
        // Клиент по этому полю решает, показывать ли кнопку входа: предлагать
        // то, что не настроено, хуже, чем не предлагать вовсе.
        googleEnabled: auth.configured(),
      });
    }

    if (path === "/api/health") {
      const catalog = await registryOf(env).counts();
      const turnConfigured = Boolean(
        env.BADYUM_CF_TURN_KEY_ID && env.BADYUM_CF_TURN_API_TOKEN,
      );
      return json({ ok: true, runtime: "workerd", turnConfigured, catalog });
    }

    if (path === "/api/channels" && request.method === "POST") {
      const parsed = createChannelSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "bad_input" }, 400);

      const caller = await creatorOf(request, new Auth(env));

      const registry = registryOf(env);
      const created = await registry.createChannelFor(caller, {
        name: parsed.data.name,
        slug: parsed.data.slug ?? null,
      });
      if (!created.ok) return json({ error: created.error }, statusFor(created.error));
      const invite = await registry.createInvite(created.channel.id);

      return json({
        channelId: created.channel.id,
        name: created.channel.name,
        inviteCode: invite.code,
      });
    }

    /**
     * Предпросмотр канала до входа: без него экран приглашения — пустая форма
     * без контекста, а это выглядит как фишинг.
     */
    if (path === "/api/preview") {
      const code = url.searchParams.get("code") ?? undefined;
      const slug = url.searchParams.get("slug") ?? undefined;

      const resolved = await registryOf(env).resolve({ code, slug });
      if (!resolved.ok) {
        // Свободное кодовое слово — не ошибка: канал создастся при входе, если
        // у входящего есть на это право.
        if (slug && resolved.error === "not_found") {
          return json({ exists: false, channelName: slug, participants: [] });
        }
        return json({ error: resolved.error }, 404);
      }

      return json({
        exists: true,
        channelId: resolved.value.channel.id,
        channelName: resolved.value.channel.name,
        participants: [],
      });
    }

    const inviteMatch = /^\/api\/channels\/([^/]+)\/invite$/.exec(path);
    if (inviteMatch) {
      const id = decodeURIComponent(inviteMatch[1]!);
      const registry = registryOf(env);
      if (!(await registry.getChannel(id))) return json({ error: "not_found" }, 404);

      // Переиспользуем живую ссылку, а не плодим новые на каждое открытие.
      const invite =
        (await registry.findInviteForChannel(id)) ?? (await registry.createInvite(id));
      return json({ code: invite.code });
    }

    /**
     * Гостевой вход: только имя, никакой регистрации. Барьер «зарегистрируйся,
     * чтобы поговорить» убивает такие проекты на старте.
     *
     * Вход и создание здесь не одно и то же. В существующий канал — по ссылке,
     * по слову, по id — пускаем кого угодно. А вот завести канал свободным
     * словом может только тот, у кого есть право: иначе запрет на
     * POST /api/channels обходился бы этой же ручкой со случайным словом.
     */
    if (path === "/api/join" && request.method === "POST") {
      const parsed = joinBodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "bad_input" }, 400);

      const displayName = normalizeDisplayName(parsed.data.displayName);
      if (!displayName) return json({ error: "bad_display_name" }, 400);

      const caller = await creatorOf(request, new Auth(env));
      const resolved = await registryOf(env).resolveFor(caller, parsed.data);
      if (!resolved.ok) return json({ error: resolved.error }, statusFor(resolved.error));

      const channel = resolved.value.channel;
      const token = await new TokenSigner(env.BADYUM_TOKEN_SECRET).signJoinToken({
        userId: newUserId(),
        channelId: channel.id,
        identityId: parsed.data.identityId ?? null,
        displayName,
        inviteCode: parsed.data.code ?? null,
      });

      return json({ token, channelId: channel.id, channelName: channel.name });
    }

    if (path.startsWith("/api/")) return json({ error: "not_found" }, 404);

    // Всё остальное — статика клиента. Ссылки-приглашения это пути (/j/x7k2mq),
    // файла по такому пути нет, и SPA-fallback настроен в wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
};
