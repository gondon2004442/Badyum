import { useMemo, useState, type FormEvent } from "react";
import type { CallEndReason, Caller } from "@badyum/shared";
import { handleOf, startLogin, nameFor, nameOf, useAccount } from "../../account.ts";
import { useContacts } from "../../contacts.ts";
import type { PresenceState } from "../../presence.ts";
import { Contacts } from "./Contacts.tsx";
import { AvatarPicker } from "./AvatarPicker.tsx";
import { Sidebar } from "../Channel/Sidebar.tsx";
import { Avatar } from "../../components/Avatar.tsx";
import { GoogleIcon, LinkIcon, SpeakerIcon } from "../../components/Icons.tsx";
import {
  knownPeople,
  myIdentityId,
  recentChannels,
  type RecentChannel,
} from "../../storage.ts";
import "../Channel/Channel.css";
import "./Home.css";

interface HomeScreenProps {
  onOpenChannel: (channel: RecentChannel) => void;
  onNewChannel: () => void;
  onOpenWord: (word: string) => void;
  busy: boolean;
  error: string | null;
  presence: PresenceState;
  onOpenDirect: (peer: Caller) => void;
  onChangeUsername: () => void;
}

/** Что человек делает на этом экране: зовёт знакомого или идёт в канал. */
type Tab = "contacts" | "channels";

const ENDINGS: Record<CallEndReason, string> = {
  declined: "Отказался говорить",
  cancelled: "Звонок отменён",
  offline: "Уже не в сети",
  busy: "Сейчас занят другим звонком",
  not_friends: "Он не в твоих контактах",
  gone: "Связь оборвалась",
};

const ago = (at: number): string => {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
};

/**
 * Экран, когда ты не в канале.
 *
 * Раньше здесь было одинокое поле для кодового слова — вернуться во вчерашний
 * канал было нечем, хотя браузер его помнит. Теперь это та же оболочка, что и
 * в канале: слева каналы, в центре — куда пойти.
 */
export function HomeScreen({
  onOpenChannel,
  onNewChannel,
  onOpenWord,
  busy,
  error,
  presence,
  onOpenDirect,
  onChangeUsername,
}: HomeScreenProps) {
  const [word, setWord] = useState("");
  const [tick, setTick] = useState(0);
  const account = useAccount();
  const contacts = useContacts(account.account);
  /**
   * Вошедшему сразу показываем контакты: он пришёл кому-то позвонить. Гостю
   * контактов нет вовсе, ему остаются каналы.
   */
  const [tab, setTab] = useState<Tab>("contacts");
  /** Открыт ли выбор аватарки. Отсюда её и меняют — экран профиля тут. */
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const showContacts = Boolean(account.account) && tab === "contacts";

  const identity = myIdentityId();
  const name = nameFor(account.account);
  /**
   * Право заводить каналы — то же правило, что на сервере: даёт вход, а там,
   * где вход не настроен, не требуется вовсе. Пока идёт загрузка считаем, что
   * право есть: мигнуть кнопкой «войти» вошедшему человеку хуже, чем на
   * мгновение показать кнопку тому, кому она не сработает.
   */
  const canCreate = Boolean(account.account) || !account.available;
  const recent = useMemo(() => recentChannels(), [tick]);
  const known = useMemo(() => knownPeople(), [tick]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = word.trim();
    if (value) onOpenWord(value);
  };

  return (
    <div className="shell shell--home">
      <Sidebar
        channelName={null}
        channelId={null}
        selfName={name}
        selfIdentity={identity}
        participantCount={0}
        recent={recent}
        onOpenChannel={onOpenChannel}
        onOpenDirect={onOpenDirect}
        onNewChannel={onNewChannel}
        onChanged={() => setTick((t) => t + 1)}
        account={account.account}
        loginAvailable={account.available}
        onLogout={() => void account.logout()}
        onOpenSettings={() => setTick((t) => t + 1)}
        onChangeUsername={onChangeUsername}
        onPickAvatar={() => setPickingAvatar(true)}
      />

      {pickingAvatar && account.account ? (
        <AvatarPicker
          account={account.account}
          onClose={() => setPickingAvatar(false)}
          onChanged={account.setAvatar}
        />
      ) : null}

      <main className="home">
        <div className="home__inner">
          {/*
            Дубль того, что на широком экране живёт в сайдбаре. Сайдбар ниже
            1100 px скрыт целиком — а телефон это основное устройство, и без
            этой строки войти с него было бы нечем. Показ решает CSS по той же
            границе, что прячет сайдбар, поэтому две копии никогда не видны
            одновременно.
          */}
          <div className="home__account">
            {account.account ? (
              <>
                {/* На телефоне сайдбар скрыт, и это единственный вход в аватарку. */}
                <button
                  className="home__account-face"
                  onClick={() => setPickingAvatar(true)}
                  title="Сменить аватарку"
                  type="button"
                >
                  <Avatar
                    userId={account.account.id}
                    name={nameOf(account.account)}
                    src={account.account.avatarUrl}
                    className="home__person-avatar"
                  />
                </button>
                <span className="home__account-name">
                  {nameOf(account.account)}
                  <button
                    className="home__account-tag home__account-tag--edit"
                    onClick={onChangeUsername}
                    title="Сменить юз"
                    type="button"
                  >
                    {handleOf(account.account) ?? "выбрать юз"}
                  </button>
                </span>
                <button
                  className="home__account-out"
                  onClick={() => void account.logout()}
                  type="button"
                >
                  Выйти
                </button>
              </>
            ) : account.available ? (
              <button
                className="home__account-in"
                onClick={() => void startLogin()}
                type="button"
              >
                <GoogleIcon size={15} />
                Войти через Google
              </button>
            ) : null}
          </div>

          <span className="home__kicker">Голосовые каналы без границ</span>
          <h1 className="home__title">Badyum</h1>

          {/*
            Переключатель только для вошедших: у гостя контактов нет вовсе, и
            вкладка, которая всегда пуста, — это обещание, которое некому
            выполнить.
          */}
          {account.account ? (
            <div className="home__tabs">
              <button
                className={`home__tab${tab === "contacts" ? " home__tab--on" : ""}`}
                onClick={() => setTab("contacts")}
                type="button"
              >
                Контакты
                {contacts.incoming.length > 0 ? (
                  <span className="home__badge">{contacts.incoming.length}</span>
                ) : null}
              </button>
              <button
                className={`home__tab${tab === "channels" ? " home__tab--on" : ""}`}
                onClick={() => setTab("channels")}
                type="button"
              >
                Каналы
              </button>
            </div>
          ) : null}

          {presence.lastEnd ? (
            <p className="home__error" onClick={presence.clearEnd}>
              {presence.lastEnd.peer ? `${nameOf(presence.lastEnd.peer)}: ` : ""}
              {ENDINGS[presence.lastEnd.reason]}
            </p>
          ) : null}

          {showContacts ? (
            <Contacts
              contacts={contacts}
              online={presence.online}
              connected={presence.connected}
              onCall={presence.dial}
              onOpen={onOpenDirect}
              busy={presence.call !== null || busy}
            />
          ) : (
            <>

          {/*
            Гостю предлагаем вход вместо кнопки, а не кнопку, которая ответит
            «войди». Создание закрыто входом намеренно: канал в каталоге стоит
            одного запроса, и без этого сервис разносится циклом в консоли.
            Заходить по чужой ссылке вход по-прежнему не нужен.
          */}
          {canCreate ? (
            <button
              className="home__primary"
              onClick={onNewChannel}
              disabled={busy}
              type="button"
            >
              <LinkIcon size={15} />
              {busy ? "Создаю…" : "Создать канал"}
            </button>
          ) : (
            <button className="home__primary" onClick={() => void startLogin()} type="button">
              <GoogleIcon size={15} />
              Войти, чтобы создать канал
            </button>
          )}

          <form className="home__word" onSubmit={submit}>
            <input
              className="home__field"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="или кодовое слово, например badyum-катка"
              maxLength={48}
              aria-label="Кодовое слово комнаты"
            />
            <button className="home__go" type="submit" disabled={!word.trim() || busy}>
              →
            </button>
          </form>
          <p className="home__hint">
            {canCreate
              ? "Назовите с другом одно и то же слово — окажетесь в одном канале"
              : "Назовите с другом одно и то же слово. Новую комнату заводит тот, кто вошёл"}
          </p>

          {error ? <p className="home__error">{error}</p> : null}

          {recent.length > 0 ? (
            <section className="home__block">
              <span className="home__label">Вернуться</span>
              <div className="home__cards">
                {recent.slice(0, 4).map((channel) => (
                  <button
                    key={channel.channelId}
                    className="home__card"
                    onClick={() => onOpenChannel(channel)}
                    disabled={!channel.code || busy}
                    title={channel.code ? "Войти" : "Ссылка утеряна"}
                    type="button"
                  >
                    <SpeakerIcon size={15} className="home__card-icon" />
                    <span className="home__card-name">{channel.name}</span>
                    <span className="home__card-when">{ago(channel.lastSeen)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {known.length > 0 ? (
            <section className="home__block">
              <span className="home__label">Знакомые</span>
              <div className="home__people">
                {known.slice(0, 8).map((person) => (
                  <span key={person.identityId} className="home__person" title={person.displayName}>
                    <Avatar
                      userId={person.identityId}
                      name={person.displayName}
                      className="home__person-avatar"
                    />
                    <span className="home__person-name">{person.displayName}</span>
                  </span>
                ))}
              </div>
              <p className="home__note">
                Список хранится только в этом браузере: с кем ты уже был в канале.
              </p>
            </section>
          ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
