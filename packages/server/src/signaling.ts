import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  clientMessageSchema,
  type Participant,
  type ServerMessage,
} from "@badyum/shared";
import { MAX_PARTICIPANTS } from "./config.ts";
import { iceServersFor } from "./turn.ts";
import type { ChannelStore } from "./channels.ts";
import type { RoomRegistry } from "./rooms.ts";
import type { ChatLog } from "./chat.ts";
import { signResumeToken, verifyJoinToken } from "./tokens.ts";
import { normalizeDisplayName } from "./ids.ts";

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
  deps: { channels: ChannelStore; rooms: RoomRegistry; chat: ChatLog },
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
    identityId: m.identityId,
    displayName: m.displayName,
    muted: m.muted,
    deafened: m.deafened,
    speaking: m.speaking,
  });

  const dropSession = (session: Session): void => {
    if (sessions.get(session.userId) !== session) return;
    sessions.delete(session.userId);

    const { remaining } = deps.rooms.leave(session.channelId, session.userId);
    deps.chat.forget(session.userId);
    broadcast(session.channelId, { type: "peer_left", userId: session.userId });

    // Эфемерный канал (кодовое слово) живёт ровно пока в нём кто-то есть.
    if (remaining === 0) {
      const channel = deps.channels.getChannel(session.channelId);
      if (channel?.ephemeral) {
        deps.channels.deleteChannel(channel.id);
        deps.chat.clear(channel.id);
      }
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

        /**
         * Возврат той же сессии.
         *
         * Телефон ушёл в сон или сеть моргнула — старый сокет остаётся зомби, и
         * heartbeat замечает это лишь спустя десятки секунд. Всё это время
         * человек не смог бы вернуться: комната считает, что он всё ещё внутри.
         * Поэтому вход под уже присутствующим userId не ошибка, а перехват.
         */
        const resumed = deps.rooms.has(claims.channelId, claims.userId);

        if (!resumed) {
          const result = deps.rooms.join({
            channelId: claims.channelId,
            userId: claims.userId,
            identityId: claims.identityId ?? null,
            displayName: claims.displayName,
            // Вошедший замьючен, пока сам не скажет обратное. Клиент так же
            // стартует, но остальные не должны ждать его первого `state`:
            // до него они видели бы у новичка живой микрофон.
            muted: true,
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
        }

        const previous = sessions.get(claims.userId);

        session = {
          socket,
          userId: claims.userId,
          channelId: claims.channelId,
          displayName: claims.displayName,
          alive: true,
        };
        // Подменяем запись до закрытия старого сокета: dropSession сверяется с
        // картой сессий и поэтому не выкинет участника из комнаты.
        sessions.set(claims.userId, session);
        if (previous && previous.socket !== socket) previous.socket.terminate();

        if (claims.inviteCode) deps.channels.consumeInvite(claims.inviteCode);

        const others = deps.rooms
          .members(claims.channelId)
          .filter((m) => m.userId !== claims.userId);

        send(socket, {
          type: "welcome",
          selfId: claims.userId,
          channelId: channel.id,
          channelName: channel.name,
          resumeToken: signResumeToken({
            userId: claims.userId,
            channelId: claims.channelId,
            identityId: claims.identityId ?? null,
            displayName: claims.displayName,
            inviteCode: null,
          }),
          resumed,
          participants: others.map(toParticipant),
          history: deps.chat.history(channel.id),
          iceServers: iceServersFor(claims.userId),
        });

        if (resumed) {
          // Второй peer_joined только сбил бы остальных: для них человек и не
          // уходил. Но предупредить надо — у кого-то соединение с ним могло
          // остаться недостроенным, пока он был вне сети.
          broadcast(
            channel.id,
            { type: "peer_resumed", userId: claims.userId },
            claims.userId,
          );
        } else {
          const self: Participant = {
            userId: claims.userId,
            identityId: claims.identityId ?? null,
            displayName: claims.displayName,
            muted: true,
            deafened: false,
            speaking: false,
          };
          broadcast(channel.id, { type: "peer_joined", participant: self }, claims.userId);
        }
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

        case "chat_send": {
          const result = deps.chat.append(
            session.channelId,
            { userId: session.userId, displayName: session.displayName },
            msg.text,
          );
          if (!result.ok) {
            if (result.error === "too_fast") {
              send(socket, {
                type: "error",
                code: "too_fast",
                message: "слишком часто — подожди пару секунд",
              });
            }
            return;
          }
          // Отправителю тоже: так у всех один и тот же порядок сообщений,
          // а не «своё сразу, чужое потом».
          broadcast(session.channelId, { type: "chat_message", message: result.message });
          return;
        }

        case "rename": {
          const name = normalizeDisplayName(msg.displayName);
          if (!name || name === session.displayName) return;

          const member = deps.rooms.rename(session.channelId, session.userId, name);
          if (!member) return;

          // Имя живёт и в сессии: с ним уходят будущие сообщения чата.
          session.displayName = name;
          broadcast(session.channelId, {
            type: "peer_renamed",
            userId: session.userId,
            displayName: name,
          });
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
