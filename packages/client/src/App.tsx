import { useCallback, useEffect, useRef, useState } from "react";
import type { Caller } from "@badyum/shared";
import { JoinScreen, type JoinTarget } from "./screens/Join/JoinScreen.tsx";
import { DirectScreen } from "./screens/Direct/DirectScreen.tsx";
import { openDirect } from "./contacts.ts";
import { CallOverlay } from "./screens/Call/CallOverlay.tsx";
import { usePresence } from "./presence.ts";
import { ChannelScreen } from "./screens/Channel/ChannelScreen.tsx";
import { HomeScreen } from "./screens/Home/HomeScreen.tsx";
import { ApiError, createChannel, fetchInviteCode, requestJoin } from "./api.ts";
import { rememberChannel, type RecentChannel } from "./storage.ts";
import { nameFor, useAccount } from "./account.ts";

interface Session {
  token: string;
  channelId: string;
  channelName: string;
  displayName: string;
  /** Код инвайта, если знаем: по нему канал попадает в «недавние». */
  code: string | null;
  /**
   * Собеседник, если это личная переписка.
   *
   * Личный канал — обычный канал, просто у него ровно один собеседник и своё
   * лицо: пока не звонишь, это переписка без микрофона.
   */
  peer?: Caller;
  /** Взяли ли микрофон. Личная переписка начинается без него. */
  voice: boolean;
}

/**
 * Разбор адреса.
 *
 * Три из четырёх способов связи — это один и тот же путь в браузер:
 *   /j/<код>   — инвайт-ссылка (и QR, потому что QR кодирует именно её)
 *   /r/<слово> — кодовое слово-комната
 * Сервер сводит их в channelId, поэтому дальше экраны одинаковы.
 */
function parseTarget(): JoinTarget | null {
  const [, kind, value] = location.pathname.split("/");
  if (!value) return null;
  if (kind === "j") return { code: value };
  if (kind === "r") return { slug: decodeURIComponent(value) };
  return null;
}

export function App() {
  const [target, setTarget] = useState<JoinTarget | null>(parseTarget);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { account } = useAccount();
  const presence = usePresence(account);

  const enter = useCallback((next: Session) => {
    rememberChannel({
      channelId: next.channelId,
      name: next.channelName,
      code: next.code,
      // Личная переписка и канал устроены одинаково, но в списке это разные
      // вещи: «Аня» и «катка» рядом путаются.
      peer: next.peer
        ? {
            userId: next.peer.userId,
            nick: next.peer.nick,
            tag: next.peer.tag,
            displayName: next.peer.displayName,
            avatarUrl: next.peer.avatarUrl,
          }
        : undefined,
    });
    if (next.code) history.replaceState({}, "", `/j/${next.code}`);
    setSession(next);
  }, []);

  /**
   * Любой вход в канал. Ошибку показываем словами: «ничего не произошло» после
   * нажатия выглядит как поломка, а канал мог просто исчезнуть.
   */
  const go = useCallback(
    async (run: () => Promise<Session>) => {
      setBusy(true);
      setError(null);
      try {
        enter(await run());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Не получилось войти в канал");
      } finally {
        setBusy(false);
      }
    },
    [enter],
  );

  /** Переход в соседний канал: выход из текущего делает сам ChannelScreen. */
  const openChannel = useCallback(
    (channel: RecentChannel) => {
      if (!channel.code) return;
      void go(async () => {
        const displayName = nameFor(account);
        const code = channel.code!;
        const result = await requestJoin({ displayName, code });
        return { ...result, displayName, code, voice: true };
      });
    },
    [go, account],
  );

  const newChannel = useCallback(() => {
    void go(async () => {
      const displayName = nameFor(account);
      const created = await createChannel("Новый канал");
      const result = await requestJoin({ displayName, code: created.inviteCode });
      return { ...result, displayName, code: created.inviteCode, voice: true };
    });
  }, [go, account]);

  const openWord = useCallback(
    (word: string) => {
      void go(async () => {
        const displayName = nameFor(account);
        const result = await requestJoin({ displayName, slug: word });
        // У канала по слову инвайта может не быть — попросим его отдельно,
        // иначе в «недавних» окажется строка, по которой не вернуться.
        const invite = await fetchInviteCode(result.channelId).catch(() => null);
        return { ...result, displayName, code: invite?.code ?? null, voice: true };
      });
    },
    [go, account],
  );

  /**
   * Звонок приняли — оба заходят в один канал по его инвайту.
   *
   * Ничего особенного для личного звонка здесь нет: это обычный канал на
   * двоих, и дальше работает ровно тот же экран разговора. Тем и хорошо —
   * дозвон добавляет только способ там оказаться.
   */
  const joined = useRef<string | null>(null);
  const { clearCall } = presence;
  const accepted = presence.call?.kind === "accepted" ? presence.call : null;
  const callCode = accepted?.code ?? null;
  const callPeer = accepted?.peer ?? null;

  useEffect(() => {
    // Оба конца получают call_accepted, и оба входят. Отметка нужна, чтобы
    // повторный рендер не отправил второй запрос на вход в тот же канал.
    if (!callCode || joined.current === callCode) return;
    joined.current = callCode;

    // Дозвон кончился — дальше нас держит канал. Иначе состояние «звоню»
    // осталось бы навсегда и не дало бы позвонить второй раз.
    clearCall();

    void go(async () => {
      const displayName = nameFor(account);
      const result = await requestJoin({ displayName, code: callCode });
      // Собеседника несём с собой: разговор идёт в личном канале, и выйти из
      // него человек должен обратно в переписку, а не на домашний экран.
      return {
        ...result,
        displayName,
        code: callCode,
        peer: callPeer ?? undefined,
        voice: true,
      };
    });
  }, [callCode, callPeer, go, account, clearCall]);

  /**
   * Нажали на контакт — открываем переписку с ним.
   *
   * Именно переписку, а не звонок: написать можно всегда, а звонок требует,
   * чтобы человек был на месте и взял трубку. Звонок начинается оттуда же,
   * кнопкой, и уходит в тот же самый канал.
   */
  const openDirectWith = useCallback(
    (peer: Caller) => {
      void go(async () => {
        const displayName = nameFor(account);
        const direct = await openDirect(peer.userId);
        const result = await requestJoin({ displayName, code: direct.code });
        return { ...result, displayName, code: direct.code, peer, voice: false };
      });
    },
    [go, account],
  );

  /**
   * Звонок поверх всего, включая разговор в канале.
   *
   * `accepted` не показываем: в этот момент мы уже заходим в канал, и держать
   * поверх него карточку звонка значит закрыть собой то, ради чего звонили.
   */
  const overlay =
    presence.call && presence.call.kind !== "accepted" ? (
      <CallOverlay
        call={presence.call}
        onAccept={presence.accept}
        onHangUp={presence.hangUp}
      />
    ) : null;

  const leaveSession = () => {
    setSession(null);
    // Цель из адреса тоже сбрасываем: иначе выход из канала возвращал бы
    // на экран входа в него же вместо домашнего.
    setTarget(null);
    history.pushState({}, "", "/");
  };

  /**
   * Переписка с человеком: тот же канал, но без микрофона.
   *
   * Пока не нажали «Позвонить», микрофон не запрашивается вовсе — написать
   * сообщение человек должен мочь, не отвечая на системный запрос.
   */
  if (session?.peer && !session.voice) {
    return (
      <>
        {overlay}
        <DirectScreen
          key={session.channelId}
          token={session.token}
          peer={session.peer}
          online={presence.online.has(session.peer.userId)}
          onCall={() => presence.dial(session.peer!)}
          onLeave={leaveSession}
          busy={presence.call !== null}
        />
      </>
    );
  }

  if (session) {
    return (
      <>
        {overlay}
      <ChannelScreen
        // Пересоздаём экран при смене канала: движок держит соединения и
        // переписку внутри, и переиспользовать его между каналами нельзя.
        key={session.channelId}
        channelId={session.channelId}
        channelName={session.channelName}
        token={session.token}
        selfName={session.displayName}
        onLeave={() => {
          // Из личного звонка выходим обратно в переписку, а не на домашний
          // экран: разговор кончился, а разговор с человеком — нет.
          if (session.peer) setSession({ ...session, voice: false });
          else leaveSession();
        }}
        onOpenChannel={openChannel}
        onNewChannel={newChannel}
      />
      </>
    );
  }

  if (target) {
    return (
      <>
        {overlay}
        <JoinScreen
          target={target}
          onJoined={(result) => enter({ ...result, code: target.code ?? null, voice: true })}
        />
      </>
    );
  }

  return (
    <>
      {overlay}
      <HomeScreen
        onOpenChannel={openChannel}
        onNewChannel={newChannel}
        onOpenWord={openWord}
        busy={busy}
        error={error}
        presence={presence}
        onOpenDirect={openDirectWith}
      />
    </>
  );
}
