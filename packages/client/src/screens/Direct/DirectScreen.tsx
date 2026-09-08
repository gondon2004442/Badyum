import { useMemo, useState } from "react";
import type { Caller } from "@badyum/shared";
import { Avatar } from "../../components/Avatar.tsx";
import { ChatIcon, SearchIcon } from "../../components/Icons.tsx";
import { GoogleButton } from "../../components/GoogleButton.tsx";
import { Sidebar } from "../Channel/Sidebar.tsx";
import { ProfileMenu } from "../Channel/ProfileMenu.tsx";
import { Talk } from "./Talk.tsx";
import { useContacts } from "../../contacts.ts";
import { nameOf, startLogin, useAccount } from "../../account.ts";
import { myIdentityId, recentChannels, type RecentChannel } from "../../storage.ts";
import "../Channel/Channel.css";
import "./Direct.css";

interface DirectScreenProps {
  /**
   * С кем разговор. `null` — раздел открыт, но переписки ещё нет ни одной.
   *
   * Это не ошибка и не загрузка, а обычное состояние нового человека. Раньше
   * его не существовало: строка «Личные» просто не нажималась, пока переписок
   * нет, а завести первую можно было только с главной. Раздел, в который
   * нельзя войти, пока в нём чего-то нет, — это тупик, а не раздел.
   */
  peer: Caller | null;
  /** Токен и канал переписки. `null` вместе с `peer`. */
  token: string | null;
  channelId: string | null;
  /** В сети ли собеседник: без этого звонить некому. */
  online: boolean;
  /** Кто из знакомых сейчас в сети — для точек в списке. */
  onlineIds: Set<string>;
  selfName: string;
  onCall: () => void;
  onLeave: () => void;
  /** Открыть переписку с другим человеком, не выходя из раздела. */
  onOpenDirect: (peer: Caller | null) => void;
  onOpenChannel: (channel: RecentChannel) => void;
  onNewChannel: () => void;
  /** Идёт другой звонок — второй начинать не даём. */
  busy: boolean;
}

/**
 * Раздел личных переписок.
 *
 * Три колонки той же оболочки, что и канал: слева навигация, посередине люди,
 * справа разговор. Раньше переписка была отдельным экраном без сайдбара, и из
 * неё приходилось «возвращаться» — то есть личные не были разделом, они были
 * тупиком.
 *
 * В колонке людей стоят не только те, с кем уже говорили, но и контакты. Иначе
 * первую переписку было не начать изнутри раздела: список показывал бы ровно
 * тех, кто в него уже попал, и попасть в него было неоткуда.
 */
export function DirectScreen({
  peer,
  token,
  channelId,
  online,
  onlineIds,
  selfName,
  onCall,
  onLeave,
  onOpenDirect,
  onOpenChannel,
  onNewChannel,
  busy,
}: DirectScreenProps) {
  const account = useAccount();
  const contacts = useContacts(account.account);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const identity = myIdentityId();

  /**
   * Кому можно написать: сначала те, с кем уже переписывались, следом
   * остальные контакты.
   *
   * Порядок именно такой: переписка — это то, к чему возвращаются, а контакт
   * без переписки — то, с чего её начинают. Прошлые разговоры знает только этот
   * браузер (сервер о них не помнит), контакты приходят с сервера, и человек
   * из обоих списков не должен появиться дважды.
   */
  const people = useMemo(() => {
    const chats = recentChannels()
      .filter((c) => c.peer)
      .map((c) => c.peer!);
    const seen = new Set(chats.map((who) => who.userId));

    const rest = contacts.friends
      .filter((c) => !seen.has(c.user.id))
      .map(
        (c): Caller => ({
          userId: c.user.id,
          username: c.user.username,
          displayName: c.user.displayName,
          avatarUrl: c.user.avatarUrl,
        }),
      );

    return [...chats, ...rest];
  }, [channelId, contacts.friends]);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((who) => nameOf(who).toLowerCase().includes(needle));
  }, [people, query]);

  return (
    <div className="directs">
      <Sidebar
        channelName={null}
        channelId={null}
        selfName={selfName}
        selfIdentity={identity}
        participantCount={0}
        recent={recentChannels()}
        onOpenChannel={onOpenChannel}
        onOpenDirect={onOpenDirect}
        onNewChannel={onNewChannel}
        onChanged={() => {}}
        onOpenProfile={() => setProfileOpen(true)}
        account={account.account}
        loginAvailable={account.available}
      />

      {profileOpen ? (
        <ProfileMenu
          account={account.account}
          selfName={selfName}
          selfIdentity={identity}
          loginAvailable={account.available}
          loggingIn={account.loggingIn}
          sound={null}
          overlay={null}
          onLogout={() => void account.logout()}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}

      <aside className="people">
        <div className="people__search">
          <SearchIcon size={17} className="people__search-icon" />
          <input
            className="people__field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти человека"
            aria-label="Найти человека"
          />
        </div>

        <div className="people__list">
          {found.map((who) => {
            const current = who.userId === peer?.userId;
            return (
              <button
                key={who.userId}
                className={`prow${current ? " prow--on" : ""}`}
                onClick={() => (current ? undefined : onOpenDirect(who))}
                type="button"
              >
                <span className="prow__face">
                  <Avatar userId={who.userId} name={nameOf(who)} src={who.avatarUrl} />
                  {onlineIds.has(who.userId) ? <i className="prow__dot" /> : null}
                </span>
                {/*
                  Имя и всё. В макете здесь ещё время и превью последнего
                  сообщения — их показать нечем: сообщения приходят только в
                  открытую переписку, и хранить последнее по каждой мы пока не
                  умеем. Выдумывать вместо этого время последнего захода значит
                  выдать его за время сообщения.
                */}
                <span className="prow__name">{nameOf(who)}</span>
              </button>
            );
          })}

          {found.length === 0 ? (
            <p className="people__empty">
              {query.trim()
                ? "Никого не нашлось"
                : account.account
                  ? "Пока некому писать. Добавь человека по юзу — это на главной, в контактах"
                  : "Личные переписки появляются у тех, кто вошёл"}
            </p>
          ) : null}
        </div>
      </aside>

      {peer && token && channelId ? (
        <Talk
          // Пересоздаём разговор при смене собеседника: движок держит
          // соединение и переписку внутри и между каналами не переиспользуется.
          key={channelId}
          token={token}
          channelId={channelId}
          peer={peer}
          online={online}
          onCall={onCall}
          busy={busy}
        />
      ) : (
        /*
          Пустая правая колонка.

          Говорит ровно то, чего не хватает, и даёт это сделать. Раньше на этом
          месте не было ничего — вместе со строкой «Личные», которая не
          нажималась.
        */
        <section className="talk talk--empty">
          <div className="nobody">
            <span className="nobody__icon">
              <ChatIcon size={26} />
            </span>
            {account.account ? (
              <>
                <h2 className="nobody__title">
                  {people.length > 0 ? "Выбери, кому написать" : "Писать пока некому"}
                </h2>
                <p className="nobody__note">
                  {people.length > 0
                    ? "Слева — те, с кем ты уже говорил, и твои контакты. Переписка остаётся между звонками."
                    : "Контакты добавляются по юзу — на главной. Как только человек примет заявку, он появится здесь."}
                </p>
                {people.length === 0 ? (
                  <button className="nobody__go" onClick={onLeave} type="button">
                    На главную
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <h2 className="nobody__title">Личные — для тех, кто вошёл</h2>
                <p className="nobody__note">
                  Написать можно тому, кто у тебя в контактах, а контакты живут в
                  аккаунте. В каналы это не мешает заходить и дальше — там вход не
                  нужен.
                </p>
                {account.available ? (
                  <GoogleButton
                    className="nobody__in"
                    onClick={() => void startLogin()}
                    disabled={account.loggingIn}
                    label={account.loggingIn ? "Жду Google…" : "Войти через Google"}
                  />
                ) : null}
              </>
            )}
          </div>
        </section>
      )}

      {/* Выход из раздела остаётся: на телефоне колонок рядом нет. */}
      <button className="directs__back" onClick={onLeave} type="button">
        Назад
      </button>
    </div>
  );
}
