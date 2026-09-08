import { useEffect, useMemo, useRef } from "react";
import type { Caller } from "@badyum/shared";
import { Avatar } from "../../components/Avatar.tsx";
import { PhoneIcon, WaveIcon } from "../../components/Icons.tsx";
import { ChatPanel } from "../Channel/ChatPanel.tsx";
import { useVoice } from "../../voice/useVoice.ts";
import { handleOf, nameOf, useAccount } from "../../account.ts";

interface TalkProps {
  token: string;
  /** Канал переписки: он же часть ключа, по которому лежат вложения. */
  channelId: string;
  peer: Caller;
  /** В сети ли собеседник: без этого звонить некому. */
  online: boolean;
  onCall: () => void;
  /** Идёт другой звонок — второй начинать не даём. */
  busy: boolean;
}

/**
 * Сам разговор: шапка с собеседником и переписка.
 *
 * Вынесен из оболочки раздела нарочно. Раздел открывается и без собеседника —
 * когда переписок ещё нет, — а движок связи создаётся вместе с этим
 * компонентом. Держи мы всё одним куском, пустой раздел поднимал бы соединение
 * с каналом, которого не существует.
 *
 * Переписка — тот же канал, что и для звонка, просто вход в него без
 * микрофона. Поэтому у переписки и разговора одна история: позвонили,
 * поговорили, вышли, а написанное осталось на месте.
 *
 * Разрешение на микрофон здесь не спрашивается намеренно: человек, который
 * зашёл написать сообщение, не должен видеть системный запрос. Микрофон
 * появляется ровно тогда, когда он нажал «Позвонить».
 */
export function Talk({ token, channelId, peer, online, onCall, busy }: TalkProps) {
  const voice = useVoice();
  const account = useAccount();

  /**
   * Кто как выглядит. В личной переписке участников ровно двое, и обоих мы
   * знаем и без канала: собеседник пришёл из контактов, свой аватар — из
   * аккаунта.
   */
  const avatars = useMemo(
    () =>
      new Map<string, string | null>([
        ...voice.participants.map((p) => [p.userId, p.avatarUrl] as const),
        ...(voice.self.selfId
          ? ([[voice.self.selfId, account.account?.avatarUrl ?? null]] as const)
          : []),
      ]),
    [voice.participants, voice.self.selfId, account.account?.avatarUrl],
  );

  const joined = useRef(false);

  useEffect(() => {
    if (joined.current) return;
    joined.current = true;
    void voice.join(token, undefined, false).catch(() => {
      // Переписка без сети — не повод показывать ошибку микрофона: его тут нет.
      // Состояние соединения и так видно по тому, уходят ли сообщения.
    });
  }, [token, voice]);

  return (
    <section className="talk">
      <header className="talk__head">
        <span className="talk__face">
          <Avatar userId={peer.userId} name={nameOf(peer)} src={peer.avatarUrl} />
          {online ? <i className="prow__dot" /> : null}
        </span>

        <span className="talk__who">
          <span className="talk__name">{nameOf(peer)}</span>
          <span className="talk__where">
            {online ? (
              <>
                <WaveIcon size={14} />
                сейчас в сети
              </>
            ) : (
              "не в сети"
            )}
          </span>
        </span>

        <button
          className="talk__call"
          onClick={onCall}
          disabled={!online || busy}
          title={online ? `Позвонить ${nameOf(peer)}` : "Не в сети"}
          type="button"
        >
          <PhoneIcon size={17} />
          Позвонить
        </button>
      </header>

      <ChatPanel
        look="direct"
        intro={
          <div className="intro">
            <Avatar
              userId={peer.userId}
              name={nameOf(peer)}
              src={peer.avatarUrl}
              className="intro__face"
            />
            <span className="intro__name">{nameOf(peer)}</span>
            {handleOf(peer) ? <span className="intro__tag">{handleOf(peer)}</span> : null}
            <p className="intro__note">
              Переписка остаётся между звонками — сюда можно кинуть ссылку и уйти.
            </p>
          </div>
        }
        messages={voice.messages}
        selfId={voice.self.selfId}
        onSend={voice.sendChat}
        typing={voice.typing}
        onTyping={voice.setTyping}
        onUpload={voice.uploadFile}
        channelId={channelId}
        avatars={avatars}
        placeholder={`Написать ${nameOf(peer)}`}
        empty={`Это переписка с ${nameOf(peer)}. Она никуда не денется между звонками.`}
      />
    </section>
  );
}
