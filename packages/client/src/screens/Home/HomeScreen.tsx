import { useMemo, useState, type FormEvent } from "react";
import { loginUrl, nameFor, useAccount } from "../../account.ts";
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
}

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
}: HomeScreenProps) {
  const [word, setWord] = useState("");
  const [tick, setTick] = useState(0);
  const account = useAccount();

  const identity = myIdentityId();
  const name = nameFor(account.account);
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
        onNewChannel={onNewChannel}
        onChanged={() => setTick((t) => t + 1)}
        account={account.account}
        loginAvailable={account.available}
        onLogout={() => void account.logout()}
        onOpenSettings={() => setTick((t) => t + 1)}
      />

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
                <Avatar
                  userId={account.account.id}
                  name={account.account.nick}
                  className="home__person-avatar"
                />
                <span className="home__account-name">
                  {account.account.nick}
                  <span className="home__account-tag">#{account.account.tag}</span>
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
              <a className="home__account-in" href={loginUrl()}>
                <GoogleIcon size={15} />
                Войти через Google
              </a>
            ) : null}
          </div>

          <span className="home__kicker">Голосовые каналы без границ</span>
          <h1 className="home__title">Badyum</h1>

          <button
            className="home__primary"
            onClick={onNewChannel}
            disabled={busy}
            type="button"
          >
            <LinkIcon size={15} />
            {busy ? "Создаю…" : "Создать канал"}
          </button>

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
            Назовите с другом одно и то же слово — окажетесь в одном канале
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
        </div>
      </main>
    </div>
  );
}
