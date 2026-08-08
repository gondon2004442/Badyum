import { useState, type FormEvent } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import { PhoneIcon } from "../../components/Icons.tsx";
import { ContactsError, type Contact, type ContactsState } from "../../contacts.ts";
import type { Caller } from "@badyum/shared";

interface ContactsProps {
  contacts: ContactsState;
  /** Кто из них сейчас здесь. */
  online: Set<string>;
  /** Живо ли соединение присутствия: без него статусы врут, и звонить нельзя. */
  connected: boolean;
  onCall: (peer: Caller) => void;
  /** Идёт звонок — второй начинать не даём. */
  busy: boolean;
}

const toCaller = (c: Contact): Caller => ({
  userId: c.user.id,
  nick: c.user.nick,
  tag: c.user.tag,
  displayName: c.user.displayName,
  avatarUrl: c.user.avatarUrl,
});

/**
 * Контакты и звонок по нику.
 *
 * Заявки стоят выше друзей: на них нужно ответить, а список друзей никуда не
 * денется. Внизу их не заметили бы.
 */
export function Contacts({ contacts, online, connected, onCall, busy }: ContactsProps) {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = handle.trim();
    if (!value || sending) return;

    setSending(true);
    setError(null);
    setDone(null);
    try {
      await contacts.add(value);
      setHandle("");
      setDone("Заявка отправлена");
    } catch (err) {
      setError(err instanceof ContactsError ? err.message : "Не получилось");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="contacts">
      <form className="contacts__add" onSubmit={submit}>
        <input
          className="home__field"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            setError(null);
            setDone(null);
          }}
          placeholder="Добавить по нику, например дюма#4821"
          maxLength={80}
          aria-label="Ник и тег человека"
        />
        <button className="home__go" type="submit" disabled={!handle.trim() || sending}>
          +
        </button>
      </form>
      {error ? <p className="contacts__error">{error}</p> : null}
      {done ? <p className="contacts__done">{done}</p> : null}

      {contacts.incoming.length > 0 ? (
        <div className="home__block">
          <span className="home__label">Хотят добавиться</span>
          {contacts.incoming.map((c) => (
            <Row key={c.user.id} contact={c}>
              <button
                className="contacts__act contacts__act--yes"
                onClick={() => void contacts.accept(c.user.id)}
                type="button"
              >
                Принять
              </button>
              <button
                className="contacts__act"
                onClick={() => void contacts.remove(c.user.id)}
                type="button"
              >
                Отклонить
              </button>
            </Row>
          ))}
        </div>
      ) : null}

      <div className="home__block">
        <span className="home__label">Контакты</span>

        {contacts.friends.map((c) => {
          const here = online.has(c.user.id);
          return (
            <Row key={c.user.id} contact={c} online={here}>
              <button
                className="contacts__call"
                onClick={() => onCall(toCaller(c))}
                disabled={!here || !connected || busy}
                title={
                  !connected
                    ? "Нет связи с сервером"
                    : here
                      ? `Позвонить ${c.user.nick}`
                      : "Не в сети"
                }
                type="button"
              >
                <PhoneIcon size={15} />
              </button>
              <button
                className="contacts__act"
                onClick={() => void contacts.remove(c.user.id)}
                title="Удалить из контактов"
                type="button"
              >
                ×
              </button>
            </Row>
          );
        })}

        {contacts.friends.length === 0 ? (
          <p className="sidebar__empty">
            Пока никого. Спроси у друга его ник с тегом — он написан у него внизу слева.
          </p>
        ) : null}
      </div>

      {contacts.outgoing.length > 0 ? (
        <div className="home__block">
          <span className="home__label">Ждут ответа</span>
          {contacts.outgoing.map((c) => (
            <Row key={c.user.id} contact={c}>
              <button
                className="contacts__act"
                onClick={() => void contacts.remove(c.user.id)}
                type="button"
              >
                Отменить
              </button>
            </Row>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Row({
  contact,
  online,
  children,
}: {
  contact: Contact;
  online?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="contact">
      <span className="contact__face">
        {contact.user.avatarUrl ? (
          <img
            className="contact__avatar contact__avatar--photo"
            src={contact.user.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <Avatar
            userId={contact.user.id}
            name={contact.user.nick}
            className="contact__avatar"
          />
        )}
        {/* Точка только у тех, про кого мы знаем наверняка — у друзей. */}
        {online !== undefined ? (
          <span className={`contact__dot${online ? " contact__dot--on" : ""}`} />
        ) : null}
      </span>

      <span className="contact__who">
        <span className="contact__name">{contact.user.nick}</span>
        <span className="contact__tag">#{contact.user.tag}</span>
      </span>

      <span className="contact__acts">{children}</span>
    </div>
  );
}
