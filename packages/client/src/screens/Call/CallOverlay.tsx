import { useEffect } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import { PhoneIcon, PhoneOffIcon } from "../../components/Icons.tsx";
import { useRinger } from "./ringer.ts";
import type { CallPhase } from "../../presence.ts";
import "./Call.css";

interface CallOverlayProps {
  call: CallPhase;
  onAccept: () => void;
  onHangUp: () => void;
}

/**
 * Экран звонка до разговора.
 *
 * Поверх всего и без возможности «мимо нажать»: звонок — единственное, что в
 * этот момент имеет значение, и потерять его среди остального интерфейса
 * хуже, чем перекрыть интерфейс.
 */
export function CallOverlay({ call, onAccept, onHangUp }: CallOverlayProps) {
  const incoming = call.kind === "ringing";
  useRinger(call.kind);

  // Escape сбрасывает. Мышью до кнопки ещё надо дойти, а отказаться человек
  // обычно хочет быстро.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onHangUp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onHangUp]);

  return (
    <div className="callscreen" role="dialog" aria-modal="true">
      <div className="callscreen__card">
        <span className="callscreen__kicker">
          {incoming ? "Входящий звонок" : call.kind === "dialing" ? "Звоню" : "Соединяю"}
        </span>

        <span className={`callscreen__face${incoming ? " callscreen__face--pulse" : ""}`}>
          {call.peer.avatarUrl ? (
            <img
              className="callscreen__avatar"
              src={call.peer.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <Avatar
              userId={call.peer.userId}
              name={call.peer.nick}
              className="callscreen__avatar"
            />
          )}
        </span>

        <h1 className="callscreen__name">{call.peer.nick}</h1>
        <span className="callscreen__tag">#{call.peer.tag}</span>

        <div className="callscreen__acts">
          {incoming ? (
            <button className="callscreen__yes" onClick={onAccept} type="button">
              <PhoneIcon size={18} />
              Ответить
            </button>
          ) : null}

          <button className="callscreen__no" onClick={onHangUp} type="button">
            <PhoneOffIcon size={18} />
            {incoming ? "Отклонить" : "Отменить"}
          </button>
        </div>
      </div>
    </div>
  );
}
