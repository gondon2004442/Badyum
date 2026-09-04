import {
  AddChannelIcon,
  ChatIcon,
  ChevronIcon,
  MicOffIcon,
  ScreenIcon,
  SpeakerIcon,
  WaveIcon,
} from "../../components/Icons.tsx";
import { Avatar } from "../../components/Avatar.tsx";
import type { Caller, Participant } from "@badyum/shared";
import { forgetChannel, type RecentChannel } from "../../storage.ts";
import { handleOf, nameOf, type Account } from "../../account.ts";

interface SidebarProps {
  /** null — мы не в канале: сайдбар тот же, активной строки просто нет. */
  channelName: string | null;
  channelId: string | null;
  selfName: string;
  selfIdentity: string;
  participantCount: number;
  /**
   * Кто сейчас в активном канале.
   *
   * Список живёт под строкой канала, а не только на сцене: свернув приложение
   * в узкое окно или уйдя в переписку, человек всё равно должен видеть, кто
   * рядом. Пустой — мы не в канале.
   */
  people?: Participant[];
  recent: RecentChannel[];
  onOpenChannel: (channel: RecentChannel) => void;
  /**
   * Открыть переписку.
   *
   * Строка «Личные» ведёт в последнюю: раздел открывается разговором, а список
   * людей стоит в нём второй колонкой. Нет ни одной переписки — вести некуда, и
   * строка это показывает, а не молчит после нажатия.
   */
  onOpenDirect?: (peer: Caller) => void;
  onNewChannel: () => void;
  onChanged: () => void;
  /** Раскрыть меню профиля. Там же вход, настройки и выход. */
  onOpenProfile: () => void;
  /** Аккаунт, если человек вошёл. Гость — null, и это нормальный режим. */
  account: Account | null;
  /** Настроен ли вход. Кнопку, которая не сработает, показывать нельзя. */
  loginAvailable: boolean;
}

/**
 * Левая колонка: где ты сейчас и куда можешь вернуться.
 *
 * Каналы в списке — не серверная сущность, а память этого браузера: сервер
 * держит их в памяти процесса и никого не опознаёт. Поэтому «мои каналы» —
 * это ровно те, куда ты заходил с этого устройства.
 *
 * Колонка темнее содержимого нарочно: глаз должен цепляться за разговор, а не
 * за меню. По той же причине активная строка показана подложкой, а не цветом
 * текста, — цвет здесь значит «происходит прямо сейчас».
 */
export function Sidebar({
  channelName,
  channelId,
  selfName,
  selfIdentity,
  participantCount,
  people = [],
  recent,
  onOpenChannel,
  onOpenDirect,
  onNewChannel,
  onChanged,
  onOpenProfile,
  account,
  loginAvailable,
}: SidebarProps) {
  const rest = recent.filter((c) => c.channelId !== channelId);
  const others = rest.filter((c) => !c.peer);
  /** Последняя переписка: в неё и ведёт строка «Личные». */
  const lastDirect = recent.find((c) => c.peer)?.peer ?? null;
  /** То же правило, что на сервере: право даёт вход, а без входа — не требуется. */
  const canCreate = Boolean(account) || !loginAvailable;

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__mark">B</span>
        <span className="sidebar__wordmark">BADYUM</span>
      </div>

      <div className="sidebar__scroll">
        {/*
          Личные — одна строка, а не список имён.

          Имена живут в своей колонке: в списке их бывает три десятка, и
          развернув их здесь, мы утопили бы в них каналы — то есть то, ради чего
          приложение открывают.
        */}
        {onOpenDirect ? (
          <button
            className="navrow"
            onClick={() => lastDirect && onOpenDirect(lastDirect)}
            disabled={!lastDirect}
            title={lastDirect ? "Личные переписки" : "Переписок пока нет"}
            type="button"
          >
            <ChatIcon size={20} className="navrow__icon" />
            <span className="navrow__name">Личные</span>
          </button>
        ) : null}

        <span className="sidebar__label">Голосовые каналы</span>

        {channelName !== null ? (
          <>
            <div className="navrow navrow--on">
              <WaveIcon size={20} className="navrow__icon" />
              <span className="navrow__name">{channelName}</span>
              {/* Точка значит «звук идёт прямо сейчас», число — сколько нас. */}
              <span className="navlive">
                <i className="navlive__dot" />
                {participantCount}
              </span>
            </div>

            {/*
              Кто в канале — прямо под его строкой.

              Это состояние, а не навигация: строки не нажимаются, потому что
              нажать на человека в голосе не на что. Гостю, пришедшему по
              ссылке, некуда и написать — аккаунта у него нет.
            */}
            {people.length > 0 ? (
              <div className="who">
                {people.map((person) => (
                  <div
                    key={person.userId}
                    className={`who__row${person.speaking ? " who__row--speaking" : ""}`}
                  >
                    <Avatar
                      userId={person.userId}
                      name={person.displayName}
                      src={person.avatarUrl}
                      className="who__face"
                    />
                    <span className="who__name">{person.displayName}</span>
                    {person.sharing ? (
                      <ScreenIcon size={16} className="who__state" />
                    ) : null}
                    {person.muted ? (
                      <MicOffIcon size={16} className="who__state who__state--off" />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {others.map((channel) => (
          <div key={channel.channelId} className="navrow navrow--closable">
            <button
              className="navrow__open"
              onClick={() => onOpenChannel(channel)}
              title={channel.code ? "Вернуться в канал" : "Ссылка утеряна"}
              disabled={!channel.code}
              type="button"
            >
              <SpeakerIcon size={20} className="navrow__icon" />
              <span className="navrow__name">{channel.name}</span>
            </button>
            {/*
              Убрать из списка можно, но кнопка появляется под курсором: в покое
              она добавляла бы к каждой строке крестик, которого в макете нет и
              который читается как «закрыть канал», а не «забыть».
            */}
            <button
              className="navrow__forget"
              onClick={() => {
                forgetChannel(channel.channelId);
                onChanged();
              }}
              title="Убрать из списка"
              type="button"
            >
              ×
            </button>
          </div>
        ))}

        {others.length === 0 && channelName === null ? (
          <p className="sidebar__empty">Каналы появятся здесь, когда ты в них зайдёшь</p>
        ) : null}
        {canCreate ? (
          <>
            <span className="sidebar__line" />
            <button className="navrow navrow--add" onClick={onNewChannel} type="button">
              <AddChannelIcon size={20} className="navrow__icon" />
              <span className="navrow__name">Новый канал</span>
            </button>
          </>
        ) : null}
      </div>

      {/*
        Строка профиля — вход в меню, а не витрина.

        Раньше рядом с именем висели шестерёнка и выход, и обе кричали одинаково
        громко, хотя выход нужен раз в жизни. Теперь здесь только «кто я», а всё
        остальное — за одним нажатием.
      */}
      <button className="sidebar__me" onClick={onOpenProfile} type="button">
        <Avatar
          userId={account?.id ?? selfIdentity}
          name={account ? nameOf(account) : selfName}
          src={account?.avatarUrl}
          className="sidebar__myface"
        />
        <span className="sidebar__identity">
          <span className="sidebar__myname">{account ? nameOf(account) : selfName}</span>
          <span className="sidebar__mytag">
            {/*
              У гостя тег — обрезок локального идентификатора: он ничего не
              подтверждает и живёт только в этом браузере. У вошедшего —
              настоящий, выданный сервисом, и по нему человека можно найти.
            */}
            {account ? (handleOf(account) ?? "юз не выбран") : `#${selfIdentity.slice(0, 4)}`}
          </span>
        </span>
        <ChevronIcon size={18} className="sidebar__chevron" />
      </button>
    </aside>
  );
}
