import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { ALLOWED_ORIGINS, MAX_PARTICIPANTS, hasTurn } from "./config.ts";
import type { ChannelStore } from "./channels.ts";
import type { RoomRegistry } from "./rooms.ts";
import { newUserId, normalizeDisplayName } from "./ids.ts";
import { signJoinToken } from "./tokens.ts";

const joinBodySchema = z
  .object({
    displayName: z.string().min(1).max(64),
    code: z.string().max(200).optional(),
    slug: z.string().max(200).optional(),
    channelId: z.string().max(200).optional(),
  })
  .refine((b) => b.code !== undefined || b.slug !== undefined || b.channelId !== undefined, {
    message: "нужен code, slug или channelId",
  });

const createChannelSchema = z.object({
  name: z.string().min(1).max(64),
  slug: z.string().max(64).optional(),
});

export function buildHttpServer(deps: {
  channels: ChannelStore;
  rooms: RoomRegistry;
}): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  app.addHook("onSend", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "origin");
    }
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
  });

  app.options("/*", async (_req, reply) => reply.code(204).send());

  app.get("/api/health", async () => ({
    ok: true,
    // Явно отдаём наружу: без TURN мобильные сети за CGNAT не соединятся,
    // и это должно быть видно на здоровье сервиса, а не всплывать у юзеров.
    turnConfigured: hasTurn,
    maxParticipants: MAX_PARTICIPANTS,
  }));

  /**
   * Предпросмотр канала до входа: кто уже внутри и как называется.
   * Именно это показывает экран приглашения — пустая форма без контекста
   * выглядит как фишинг.
   */
  app.get("/api/preview", async (req, reply) => {
    const query = z
      .object({ code: z.string().optional(), slug: z.string().optional() })
      .parse(req.query);

    const resolved = deps.channels.resolve(query, { createMissingSlug: false });
    if (!resolved.ok) {
      // Свободное кодовое слово — не ошибка: канал создастся при входе.
      if (query.slug && resolved.error === "not_found") {
        return { exists: false, channelName: query.slug, participants: [] };
      }
      return reply.code(404).send({ error: resolved.error });
    }

    const { channel } = resolved.value;
    return {
      exists: true,
      channelId: channel.id,
      channelName: channel.name,
      participants: deps.rooms.members(channel.id).map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
      })),
    };
  });

  /**
   * Выдаёт токен на вход. Это и есть гостевой вход: только имя, никакой
   * регистрации — барьер "зарегистрируйся, чтобы поговорить" убивает такие
   * проекты на старте.
   */
  app.post("/api/join", async (req, reply) => {
    const parsed = joinBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_input", detail: parsed.error.issues });
    }

    const displayName = normalizeDisplayName(parsed.data.displayName);
    if (!displayName) return reply.code(400).send({ error: "bad_display_name" });

    const resolved = deps.channels.resolve(parsed.data, { createMissingSlug: true });
    if (!resolved.ok) return reply.code(404).send({ error: resolved.error });

    const { channel } = resolved.value;
    if (deps.rooms.size(channel.id) >= MAX_PARTICIPANTS) {
      return reply.code(409).send({ error: "channel_full" });
    }

    const token = signJoinToken({
      userId: newUserId(),
      channelId: channel.id,
      displayName,
      inviteCode: parsed.data.code ?? null,
    });

    return { token, channelId: channel.id, channelName: channel.name };
  });

  app.post("/api/channels", async (req, reply) => {
    const parsed = createChannelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_input" });

    const channel = deps.channels.createChannel({
      name: parsed.data.name,
      slug: parsed.data.slug ?? null,
    });
    const invite = deps.channels.createInvite(channel.id);

    return { channelId: channel.id, name: channel.name, inviteCode: invite.code };
  });

  /** Ссылка-приглашение для канала: переиспользуем живую, а не плодим новые. */
  app.get("/api/channels/:id/invite", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!deps.channels.getChannel(id)) return reply.code(404).send({ error: "not_found" });

    const invite =
      deps.channels.findInviteForChannel(id) ?? deps.channels.createInvite(id);
    return { code: invite.code };
  });

  return app;
}
