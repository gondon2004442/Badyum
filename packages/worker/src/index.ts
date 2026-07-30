import { z } from "zod";
import { identityIdSchema } from "@badyum/shared";
import { normalizeDisplayName } from "@badyum/core";
import { Registry } from "./Registry.ts";

export { Registry };

export interface Env {
  REGISTRY: DurableObjectNamespace<Registry>;
}

/**
 * Каталог один на весь сервис, поэтому и имя у него одно фиксированное. Будь
 * имён несколько, инвайт-код перестал бы быть уникальным, и двое по одной
 * ссылке могли бы попасть в разные каналы.
 */
const REGISTRY_NAME = "global";

const registryOf = (env: Env) => env.REGISTRY.get(env.REGISTRY.idFromName(REGISTRY_NAME));

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
  Response.json(body, {
    status,
    // CORS не нужен: страница и Worker живут на одном домене, а разрешать
    // лишнее — только расширять поверхность.
    headers: { "cache-control": "no-store" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      const catalog = await registryOf(env).counts();
      return json({ ok: true, runtime: "workerd", catalog });
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
     * Предпросмотр канала до входа. Без него экран приглашения — пустая форма
     * без контекста, а это выглядит как фишинг.
     *
     * Список участников пока пустой: они живут в ChannelRoom, которого ещё нет.
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
     * Вход. Токен пока не выдаём: он подписывается асинхронным WebCrypto и
     * появится вместе с ChannelRoom. Но разрешение канала уже работает, и
     * проверяемо именно здесь — включая создание канала по свободному слову.
     */
    if (path === "/api/join" && request.method === "POST") {
      const parsed = joinBodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "bad_input" }, 400);

      const displayName = normalizeDisplayName(parsed.data.displayName);
      if (!displayName) return json({ error: "bad_display_name" }, 400);

      const resolved = await registryOf(env).resolve(parsed.data, { createMissingSlug: true });
      if (!resolved.ok) return json({ error: resolved.error }, 404);

      return json({
        channelId: resolved.value.channel.id,
        channelName: resolved.value.channel.name,
        source: resolved.value.source,
      });
    }

    return json({ error: "not_found" }, 404);
  },
};
