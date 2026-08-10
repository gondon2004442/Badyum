import { useEffect, useRef } from "react";
import type { Caller } from "@badyum/shared";
import { Avatar } from "../../components/Avatar.tsx";
import { ExitIcon, PhoneIcon } from "../../components/Icons.tsx";
import { ChatPanel } from "../Channel/ChatPanel.tsx";
import { useVoice } from "../../voice/useVoice.ts";
import "../Channel/Channel.css";
import "./Direct.css";

interface DirectScreenProps {
  token: string;
  peer: Caller;
  /** В сети ли собеседник: без этого звонить некому. */
  online: boolean;
  onCall: () => void;
  onLeave: () => void;
  /** Идёт другой звонок — второй начинать не даём. */
  busy: boolean;
}

/**
 * Переписка с человеком.
 *
 * Это тот же канал, что и для звонка, — просто вход в него без микрофона.
 * Поэтому у переписки и разговора одна история: позвонили, поговорили, вышли,
 * а написанное осталось на месте.
 *
 * Разрешение на микрофон здесь не спрашивается намеренно: человек, который
 * зашёл написать сообщение, не должен видеть системный запрос. Микрофон
 * появляется ровно тогда, когда он нажал «Позвонить».
 */
export function DirectScreen({
  token,
  peer,
  online,
  onCall,
  onLeave,
  busy,
}: DirectScreenProps) {
  const voice = useVoice();
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
    <div className="direct">
      <header className="direct__top">
        <button className="direct__back" onClick={onLeave} title="Назад" type="button">
          <ExitIcon size={17} />
        </button>

        <span className="direct__face">
          {peer.avatarUrl ? (
            <img
              className="direct__avatar"
              src={peer.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <Avatar userId={peer.userId} name={peer.nick} className="direct__avatar" />
          )}
          <span className={`contact__dot${online ? " contact__dot--on" : ""}`} />
        </span>

        <span className="direct__who">
          <span className="direct__name">{peer.nick}</span>
          <span className="direct__status">{online ? "в сети" : "не в сети"}</span>
        </span>

        <button
          className="direct__call"
          onClick={onCall}
          disabled={!online || busy}
          title={online ? `Позвонить ${peer.nick}` : "Не в сети"}
          type="button"
        >
          <PhoneIcon size={16} />
          Позвонить
        </button>
      </header>

      <ChatPanel
        messages={voice.messages}
        selfId={voice.self.selfId}
        onSend={voice.sendChat}
        typing={voice.typing}
        onTyping={voice.setTyping}
        placeholder={`Написать ${peer.nick}`}
        empty={`Это переписка с ${peer.nick}. Она никуда не денется между звонками.`}
      />
    </div>
  );
}
