import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@badyum/shared";
import { Avatar } from "../../components/Avatar.tsx";

interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string | null;
  onSend: (text: string) => void;
}

/** Сообщения одного человека подряд — одной группой, без повтора имени. */
function groupsOf(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];

  for (const message of messages) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    const prev = last?.[last.length - 1];

    const sameAuthor = head?.userId === message.userId;
    // Пять минут — примерно та пауза, после которой это уже другой разговор.
    const soonAfter = prev !== undefined && message.at - prev.at < 5 * 60_000;

    if (last && sameAuthor && soonAfter) last.push(message);
    else groups.push([message]);
  }

  return groups;
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({ messages, selfId, onSend }: ChatPanelProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Прокручиваем вниз только если человек и так внизу. Иначе новое сообщение
  // выдёргивало бы его из середины переписки, которую он читает.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const onScroll = () => {
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      pinnedRef.current = distance < 80;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
    pinnedRef.current = true;
  };

  const groups = groupsOf(messages);

  return (
    <section className="chat">
      <div className="chat__list" ref={listRef}>
        {groups.length === 0 ? (
          <p className="chat__empty">
            Здесь можно написать, когда говорить не с руки — скинуть ссылку или
            ответить, не перебивая.
          </p>
        ) : (
          groups.map((group) => {
            const head = group[0]!;
            const mine = head.userId === selfId;

            return (
              <div key={head.id} className={`msg ${mine ? "msg--mine" : ""}`}>
                <Avatar
                  userId={head.userId}
                  name={head.displayName}
                  className="msg__avatar"
                />
                <div className="msg__body">
                  <div className="msg__head">
                    <span className="msg__author">{head.displayName}</span>
                    <span className="msg__time">{time(head.at)}</span>
                  </div>
                  {group.map((message) => (
                    <p key={message.id} className="msg__text">
                      {message.text}
                    </p>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form className="chat__compose" onSubmit={submit}>
        <input
          className="chat__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Написать в канал"
          maxLength={2000}
          aria-label="Сообщение в канал"
        />
        <button className="chat__send" type="submit" disabled={!text.trim()}>
          ↵
        </button>
      </form>
    </section>
  );
}
