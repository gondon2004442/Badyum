import { z } from "zod";
import { identityIdSchema } from "@badyum/shared";
import { newUserId, normalizeDisplayName, TokenSigner } from "@badyum/core";
import { Registry } from "./Registry.ts";
import { ChannelRoom } from "./ChannelRoom.ts";
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

      const registry = registryOf(env);
      const channel = await registry.createChannel({
        name: parsed.data.name,
        slug: parsed.data.slug ?? null,
      });
      const invite = await registry.createInvite(channel.id);

      return json({ channelId: channel.id, name: channel.name, inviteCode: invite.code });
    }

    /**
     * Предпросмотр канала до входа: без него экран приглашения — пустая форма
     * без контекста, а это выглядит как фишинг.
     */
    if (path === "/api/preview") {
      const code = url.searchParams.get("code") ?? undefined;
      const slug = url.searchParams.get("slug") ?? undefined;

      const resolved = await registryOf(env).resolve({ code, slug }, { createMissingSlug: false });
      if (!resolved.ok) {
        // Свободное кодовое слово — не ошибка: канал создастся при входе.
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
     */
    if (path === "/api/join" && request.method === "POST") {
      const parsed = joinBodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "bad_input" }, 400);

      const displayName = normalizeDisplayName(parsed.data.displayName);
      if (!displayName) return json({ error: "bad_display_name" }, 400);

      const resolved = await registryOf(env).resolve(parsed.data, { createMissingSlug: true });
      if (!resolved.ok) return json({ error: resolved.error }, 404);

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
