import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  clientMessageSchema,
  type Participant,
  type ServerMessage,
} from "@badyum/shared";
import { MAX_PARTICIPANTS, iceServersFor } from "./config.ts";
import type { ChannelStore } from "./channels.ts";
import type { RoomRegistry } from "./rooms.ts";
import { verifyJoinToken } from "./tokens.ts";

interface Session {
  socket: WebSocket;
  userId: string;
  channelId: string;
  displayName: string;
  alive: boolean;
}

const HEARTBEAT_MS = 25_000;

/**
 * WebSocket-хаб.
 *
 * Сервер не разбирает SDP и не видит медиа: он держит "кто в какой комнате" и
 * пересылает конверты `signal` адресату. Весь бэкенд звонка — это он.
 */
export function attachSignaling(
  server: Server,
  deps: { channels: ChannelStore; rooms: RoomRegistry },
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  /** userId -> сессия. Нужен, чтобы адресно доставить signal. */
  const sessions = new Map<string, Session>();

  const send = (socket: WebSocket, msg: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  const broadcast = (channelId: string, msg: ServerMessage, exceptUserId?: string): void => {
    for (const member of deps.rooms.members(channelId)) {
      if (member.userId === exceptUserId) continue;
      const target = sessions.get(member.userId);
      if (target) send(target.socket, msg);
    }
  };

  const toParticipant = (m: Participant): Participant => ({
    userId: m.userId,
    displayName: m.displayName,
    muted: m.muted,
    deafened: m.deafened,
    speaking: m.speaking,
  });

  const dropSession = (session: Session): void => {
    if (sessions.get(session.userId) !== session) return;
    sessions.delete(session.userId);

    const { remaining } = deps.rooms.leave(session.channelId, session.userId);
    broadcast(session.channelId, { type: "peer_left", userId: session.userId });

    // Эфемерный канал (кодовое слово) живёт ровно пока в нём кто-то есть.
    if (remaining === 0) {
      const channel = deps.channels.getChannel(session.channelId);
      if (channel?.ephemeral) deps.channels.deleteChannel(channel.id);
    }
  };

  wss.on("connection", (socket) => {
    let session: Session | null = null;

    socket.on("message", (raw) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: "error", code: "bad_message", message: "не JSON" });
      }

      const parsed = clientMessageSchema.safeParse(parsedJson);
      if (!parsed.success) {
        return send(socket, {
          type: "error",
          code: "bad_message",
          message: "сообщение не соответствует протоколу",
        });
      }
      const msg = parsed.data;

      if (msg.type === "ping") return send(socket, { type: "pong" });

      if (msg.type === "join") {
        if (session) {
          return send(socket, {
            type: "error",
            code: "already_joined",
            message: "сессия уже в канале",
          });
        }

        const claims = verifyJoinToken(msg.token);
        if (!claims) {
          return send(socket, {
            type: "error",
            code: "bad_token",
            message: "токен недействителен или истёк",
          });
        }

        const channel = deps.channels.getChannel(claims.channelId);
        if (!channel) {
          return send(socket, {
            type: "error",
            code: "channel_not_found",
            message: "канала больше нет",
          });
        }

        const result = deps.rooms.join({
          channelId: claims.channelId,
          userId: claims.userId,
          displayName: claims.displayName,
          muted: false,
          deafened: false,
          speaking: false,
        });
        if (!result.ok) {
          return send(socket, {
            type: "error",
            code: result.error,
            message:
              result.error === "channel_full"
                ? `в канале максимум ${MAX_PARTICIPANTS} человек`
                : "уже в канале",
          });
        }

        session = {
          socket,
          userId: claims.userId,
          channelId: claims.channelId,
          displayName: claims.displayName,
          alive: true,
        };
        sessions.set(claims.userId, session);
        if (claims.inviteCode) deps.channels.consumeInvite(claims.inviteCode);

        const self: Participant = {
          userId: claims.userId,
          displayName: claims.displayName,
          muted: false,
          deafened: false,
          speaking: false,
        };

        send(socket, {
          type: "welcome",
          selfId: claims.userId,
          channelId: channel.id,
          channelName: channel.name,
          participants: result.others.map(toParticipant),
          iceServers: iceServersFor(claims.userId),
        });
        broadcast(channel.id, { type: "peer_joined", participant: self }, claims.userId);
        return;
      }

      if (!session) {
        return send(socket, {
          type: "error",
          code: "not_joined",
          message: "сначала join",
        });
      }

      switch (msg.type) {
        case "signal": {
          // Адресная пересылка вслепую. Проверяем только что адресат в той же
          // комнате — иначе канал становится способом слать что угодно кому угодно.
          if (!deps.rooms.has(session.channelId, msg.to)) return;
          const target = sessions.get(msg.to);
          if (!target) return;
          send(target.socket, {
            type: "signal",
            from: session.userId,
            payload: msg.payload,
          });
          return;
        }

        case "state": {
          const member = deps.rooms.setState(session.channelId, session.userId, {
            muted: msg.muted,
            deafened: msg.deafened,
            speaking: msg.speaking,
          });
          if (!member) return;
          broadcast(
            session.channelId,
            {
              type: "peer_state",
              userId: member.userId,
              muted: member.muted,
              deafened: member.deafened,
              speaking: member.speaking,
            },
            session.userId,
          );
          return;
        }

        case "leave": {
          dropSession(session);
          session = null;
          return;
        }
      }
    });

    socket.on("pong", () => {
      if (session) session.alive = true;
    });

    socket.on("close", () => {
      if (session) dropSession(session);
      session = null;
    });

    socket.on("error", () => {
      if (session) dropSession(session);
      session = null;
    });
  });

  // Мёртвые соединения иначе висят в комнате аватарами-призраками: браузер на
  // телефоне уходит в сон и close не всегда доезжает.
  const heartbeat = setInterval(() => {
    for (const session of [...sessions.values()]) {
      if (!session.alive) {
        session.socket.terminate();
        dropSession(session);
        continue;
      }
      session.alive = false;
      session.socket.ping();
    }
  }, HEARTBEAT_MS);

  wss.on("close", () => clearInterval(heartbeat));
  return wss;
}
