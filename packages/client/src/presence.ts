import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CallEndReason,
  Caller,
  PresenceClientMessage,
  PresenceServerMessage,
} from "@badyum/shared";
import { publicOrigin } from "./api.ts";
import type { Account } from "./account.ts";

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

/** Куда клиент дошёл в разговоре о звонке. */
export type CallPhase =
  /** Звоним, ждём ответа. */
  | { kind: "dialing"; callId: string; peer: Caller; code: string | null }
  /** Звонят нам. */
  | { kind: "ringing"; callId: string; peer: Caller; code: string }
  /** Согласились — пора заходить в канал. */
  | { kind: "accepted"; callId: string; peer: Caller; code: string };

export interface PresenceState {
  /** Кто из друзей сейчас здесь. */
  online: Set<string>;
  /** Живо ли соединение. Пока нет — звонить нельзя, и это видно. */
  connected: boolean;
  call: CallPhase | null;
  /** Чем кончился прошлый звонок. Нужно, чтобы сказать «не в сети», а не молчать. */
  lastEnd: { reason: CallEndReason; peer: Caller | null } | null;
  dial: (peer: Caller) => void;
  accept: () => void;
  /** Сбросить, отменить, не дождаться — с любой стороны одно и то же. */
  hangUp: () => void;
  /**
   * Звонок состоялся, и мы уже в канале — состояние дозвона можно убрать.
   *
   * Отдельно от `hangUp`: тот сообщает собеседнику, что разговора не будет.
   * Здесь ровно наоборот — разговор начался. Без этого «звоню» висело бы
   * вечно и не давало позвонить второй раз.
   */
  clearCall: () => void;
  clearEnd: () => void;
}

const presenceUrl = (): string => {
  const origin = publicOrigin();
  return `${origin.replace(/^http/, "ws")}/presence`;
};

/**
 * Присутствие и звонки.
 *
 * Соединение одно на вошедшего и живёт, пока открыт сайт: тому, кому звонят,
 * надо сообщить прямо сейчас, а не когда он в следующий раз что-нибудь
 * спросит. Гость сюда не подключается вовсе — ему некому звонить и незачем
 * тратить соединение.
 */
export function usePresence(account: Account | null): PresenceState {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [call, setCall] = useState<CallPhase | null>(null);
  const [lastEnd, setLastEnd] = useState<PresenceState["lastEnd"]>(null);

  const socketRef = useRef<WebSocket | null>(null);
  /**
   * Собеседник текущей попытки.
   *
   * Отдельно от `call`, потому что читать состояние React из обработчика
   * сокета нельзя — он замкнёт то значение, что было при подписке.
   */
  const peerRef = useRef<Caller | null>(null);

  useEffect(() => {
    if (!account) {
      setOnline(new Set());
      setConnected(false);
      return;
    }

    let closedByUs = false;
    let attempt = 0;
    let timer: number | null = null;

    const open = () => {
      const socket = new WebSocket(presenceUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      socket.onmessage = (event) => {
        let msg: PresenceServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as PresenceServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case "online":
            setOnline(new Set(msg.userIds));
            return;

          case "presence":
            setOnline((prev) => {
              const next = new Set(prev);
              if (msg.online) next.add(msg.userId);
              else next.delete(msg.userId);
              return next;
            });
            return;

          case "call_incoming":
            peerRef.current = msg.from;
            setCall({ kind: "ringing", callId: msg.callId, peer: msg.from, code: msg.code });
            return;

          case "call_ringing":
            peerRef.current = msg.to;
            // Гудки начинаются только сейчас: до ответа сервера мы не знаем,
            // на месте ли человек, и обещать «звоню» было бы враньём.
            setCall({ kind: "dialing", callId: msg.callId, peer: msg.to, code: msg.code });
            return;

          case "call_accepted":
            setCall((prev) =>
              prev && prev.callId === msg.callId
                ? { kind: "accepted", callId: msg.callId, peer: prev.peer, code: msg.code }
                : prev,
            );
            return;

          case "call_ended":
            setCall(null);
            setLastEnd({ reason: msg.reason, peer: peerRef.current });
            return;
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        setConnected(false);
        if (closedByUs) return;

        // Соединение оборвалось — значит и звонок оборвался. Оставить на экране
        // «звоню…» хуже, чем честно его убрать.
        setCall(null);

        const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        timer = window.setTimeout(open, delay);
      };

      socket.onerror = () => socket.close();
    };

    open();

    return () => {
      closedByUs = true;
      if (timer !== null) clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [account?.id]);

  const send = useCallback((msg: PresenceClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }, []);

  const dial = useCallback(
    (peer: Caller) => {
      // Идентификатор задаём сами: иначе отказ «его нет в сети» невозможно
      // связать с попыткой, о которой сервер ещё не успел рассказать.
      const callId = crypto.randomUUID();
      peerRef.current = peer;
      setLastEnd(null);
      send({ type: "call", to: peer.userId, callId });
    },
    [send],
  );

  const accept = useCallback(() => {
    setCall((prev) => {
      if (prev?.kind === "ringing") send({ type: "call_accept", callId: prev.callId });
      return prev;
    });
  }, [send]);

  const hangUp = useCallback(() => {
    setCall((prev) => {
      if (prev) send({ type: "call_end", callId: prev.callId });
      return null;
    });
  }, [send]);

  return {
    online,
    connected,
    call,
    lastEnd,
    dial,
    accept,
    hangUp,
    clearCall: useCallback(() => setCall(null), []),
    clearEnd: useCallback(() => setLastEnd(null), []),
  };
}
