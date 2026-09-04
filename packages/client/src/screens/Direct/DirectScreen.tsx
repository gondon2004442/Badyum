import { useEffect, useMemo, useRef, useState } from "react";
import type { Caller } from "@badyum/shared";
import { Avatar } from "../../components/Avatar.tsx";
import { PhoneIcon, SearchIcon, WaveIcon } from "../../components/Icons.tsx";
import { ChatPanel } from "../Channel/ChatPanel.tsx";
import { Sidebar } from "../Channel/Sidebar.tsx";
import { ProfileMenu } from "../Channel/ProfileMenu.tsx";
import { useVoice } from "../../voice/useVoice.ts";
import { handleOf, nameOf, useAccount } from "../../account.ts";
import { myIdentityId, recentChannels, type RecentChannel } from "../../storage.ts";
import "../Channel/Channel.css";
import "./Direct.css";

interface DirectScreenProps {
  token: string;
  /** Канал переписки: он же часть ключа, по которому лежат вложения. */
  channelId: string;
  peer: Caller;
  /** В сети ли собеседник: без этого звонить некому. */
  online: boolean;
  /** Кто из знакомых сейчас в сети — для точек в списке. */
  onlineIds: Set<string>;
  selfName: string;
  onCall: () => void;
  onLeave: () => void;
  /** Открыть переписку с другим человеком, не выходя из раздела. */
  onOpenDirect: (peer: Caller) => void;
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
 * Сама переписка — тот же канал, что и для звонка, просто вход в него без
 * микрофона. Поэтому у переписки и разговора одна история: позвонили,
 * поговорили, вышли, а написанное осталось на месте.
 *
 * Разрешение на микрофон здесь не спрашивается намеренно: человек, который
 * зашёл написать сообщение, не должен видеть системный запрос. Микрофон
 * появляется ровно тогда, когда он нажал «Позвонить».
 */
export function DirectScreen({
  token,
  channelId,
  peer,
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
  const voice = useVoice();
  const account = useAccount();
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const identity = myIdentityId();

  /** Переписки этого браузера. Сервер о них не знает — список местный. */
  const chats = useMemo(
    () => recentChannels().filter((c) => c.peer),
    [channelId],
  );

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((c) => nameOf(c.peer!).toLowerCase().includes(needle));
  }, [chats, query]);

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
          {found.map((chat) => {
            const who = chat.peer!;
            const current = who.userId === peer.userId;
            return (
              <button
                key={chat.channelId}
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
              {query.trim() ? "Никого не нашлось" : "Здесь появятся те, с кем ты переписывался"}
            </p>
          ) : null}
        </div>
      </aside>

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

      {/* Выход из раздела остаётся: на телефоне колонок рядом нет. */}
      <button className="directs__back" onClick={onLeave} type="button">
        Назад
      </button>
    </div>
  );
}
