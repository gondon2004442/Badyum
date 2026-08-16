import { Avatar } from "../../components/Avatar.tsx";
import {
  ExitIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
} from "../../components/Icons.tsx";
import { ChatPanel } from "../Channel/ChatPanel.tsx";
import type { useVoice } from "../../voice/useVoice.ts";
import "./Overlay.css";

interface OverlayPanelProps {
  /**
   * Весь разговор целиком.
   *
   * Панель показывает почти то же, что и обычный экран, поэтому перечислять
   * два десятка полей по одному значило бы держать их в согласии вручную и
   * ломать панель каждый раз, когда в разговоре появляется что-то новое.
   */
  voice: ReturnType<typeof useVoice>;
  channelId: string;
  channelName: string;
  selfName: string;
  selfAvatarUrl: string | null;
  /** Кто как выглядит — переписке нужны те же аватарки, что и в канале. */
  avatars: Map<string, string | null>;
  /** Свернуть панель обратно в обычное окно. */
  onCollapse: () => void;
  onLeave: () => void;
}

/**
 * Панель канала поверх игры.
 *
 * Это не отдельный экран, а другой вид того же самого: её рисует тот же
 * компонент, который держит разговор. Иначе переключение размонтировало бы
 * движок и оборвало звонок — ровно то, ради чего панель и заводится.
 *
 * Состав сознательно урезан. Здесь нет настроек, приглашений, показа экрана и
 * списка каналов: панель закрывает собой игру, и каждый лишний элемент — это
 * отнятый у игры кусок. Оставлено то, ради чего в неё заглядывают посреди
 * катки: кто говорит, что написали, и как замолчать.
 */
export function OverlayPanel({
  voice,
  channelId,
  channelName,
  selfName,
  selfAvatarUrl,
  avatars,
  onCollapse,
  onLeave,
}: OverlayPanelProps) {
  const people = [
    {
      userId: voice.self.selfId ?? "self",
      name: selfName,
      avatarUrl: selfAvatarUrl,
      speaking: voice.self.speaking,
      muted: voice.self.muted,
    },
    ...voice.participants.map((participant) => ({
      userId: participant.userId,
      name: participant.displayName,
      avatarUrl: participant.avatarUrl,
      speaking: participant.speaking,
      muted: participant.muted,
    })),
  ];

  return (
    <div className="ov">
      {/*
        Шапка — единственное, за что панель можно утащить: рамки у окна нет.
        Кнопки внутри помечать не надо, признак не наследуется, иначе нажатие
        на них превращалось бы в перетаскивание.
      */}
      <header className="ov__bar" data-tauri-drag-region>
        <span className="ov__name" data-tauri-drag-region>
          {channelName}
        </span>
        <span className="ov__count" data-tauri-drag-region>
          {people.length}
        </span>
        <button
          className="ov__collapse"
          onClick={onCollapse}
          title="Свернуть панель"
          type="button"
        >
          ×
        </button>
      </header>

      <div className="ov__people">
        {people.map((person) => (
          <div
            key={person.userId}
            className={`ov__person ${person.speaking ? "ov__person--live" : ""}`}
            title={person.name}
          >
            <Avatar
              userId={person.userId}
              name={person.name}
              src={person.avatarUrl}
              className="ov__face"
              dimmed={person.muted}
            />
            {person.muted ? (
              <span className="ov__muted">
                <MicOffIcon size={10} />
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="ov__chat">
        <ChatPanel
          messages={voice.messages}
          selfId={voice.self.selfId}
          onSend={voice.sendChat}
          typing={voice.typing}
          onTyping={voice.setTyping}
          onUpload={voice.uploadFile}
          channelId={channelId}
          avatars={avatars}
          /*
            Своя заглушка для пустого чата: обычная рассчитана на широкую
            колонку и в 340 пикселях занимает панель целиком, оставляя от
            переписки одну подпись о том, что переписки нет.
          */
          empty="Пока тихо"
        />
      </div>

      <footer className="ov__acts">
        {/*
          При включённой рации микрофон не выключен, но и не передаёт. Без
          отдельного состояния человек говорит в пустоту и не понимает, почему
          его не слышат, — а в панели это заметить ещё сложнее, чем на экране.
        */}
        <button
          className={`ov__ctrl ${
            voice.self.muted ? "" : voice.self.transmitting ? "ov__ctrl--on" : "ov__ctrl--armed"
          }`}
          onClick={() => voice.setMuted(!voice.self.muted)}
          title={voice.self.muted ? "Включить микрофон" : "Выключить микрофон"}
          type="button"
        >
          {voice.self.muted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
        </button>

        <button
          className={`ov__ctrl ${voice.self.deafened ? "ov__ctrl--danger" : ""}`}
          onClick={() => voice.setDeafened(!voice.self.deafened)}
          title={voice.self.deafened ? "Включить звук" : "Оглохнуть"}
          type="button"
        >
          <HeadphonesIcon size={16} />
        </button>

        <div className="ov__gap" />

        <button className="ov__ctrl ov__ctrl--leave" onClick={onLeave} title="Выйти" type="button">
          <ExitIcon size={16} />
        </button>
      </footer>
    </div>
  );
}
