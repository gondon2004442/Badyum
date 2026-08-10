import {
  ExitIcon,
  GoogleIcon,
  LinkIcon,
  SlidersIcon,
  SpeakerIcon,
} from "../../components/Icons.tsx";
import { Avatar } from "../../components/Avatar.tsx";
import type { Caller } from "@badyum/shared";
import { forgetChannel, type RecentChannel } from "../../storage.ts";
import { loginUrl, type Account } from "../../account.ts";

interface SidebarProps {
  /** null — мы не в канале: сайдбар тот же, активной строки просто нет. */
  channelName: string | null;
  channelId: string | null;
  selfName: string;
  selfIdentity: string;
  participantCount: number;
  recent: RecentChannel[];
  onOpenChannel: (channel: RecentChannel) => void;
  /** Открыть переписку с человеком. Отдельно: у неё своё лицо и свой раздел. */
  onOpenDirect?: (peer: Caller) => void;
  onNewChannel: () => void;
  onChanged: () => void;
  onOpenSettings: () => void;
  /** Аккаунт, если человек вошёл. Гость — null, и это нормальный режим. */
  account: Account | null;
  /** Настроен ли вход. Кнопку, которая не сработает, показывать нельзя. */
  loginAvailable: boolean;
  onLogout: () => void;
}

/**
 * Левая колонка: где ты сейчас и куда можешь вернуться.
 *
 * Каналы в списке — не серверная сущность, а память этого браузера: сервер
 * держит их в памяти процесса и никого не опознаёт. Поэтому «мои каналы» —
 * это ровно те, куда ты заходил с этого устройства.
 */
export function Sidebar({
  channelName,
  channelId,
  selfName,
  selfIdentity,
  participantCount,
  recent,
  onOpenChannel,
  onOpenDirect,
  onNewChannel,
  onChanged,
  onOpenSettings,
  account,
  loginAvailable,
  onLogout,
}: SidebarProps) {
  // Личные переписки и каналы — два разных списка. Вперёд идут люди: к ним
  // возвращаются чаще, чем в комнату по кодовому слову.
  const rest = recent.filter((c) => c.channelId !== channelId);
  const directs = rest.filter((c) => c.peer);
  const others = rest.filter((c) => !c.peer);
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
          Личные переписки впереди каналов: к людям возвращаются чаще, чем в
          комнату по кодовому слову. Раздела нет вовсе, пока переписок нет —
          пустой заголовок только занимал бы место.
        */}
        {directs.length > 0 && onOpenDirect ? (
          <div className="sidebar__section">
            <span className="sidebar__label">Личные</span>

            {directs.map((chat) => (
              <div key={chat.channelId} className="chan">
                <button
                  className="chan__open"
                  onClick={() => onOpenDirect(chat.peer!)}
                  title={`Переписка с ${chat.peer!.nick}`}
                  type="button"
                >
                  {chat.peer!.avatarUrl ? (
                    <img
                      className="chan__face chan__face--photo"
                      src={chat.peer!.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Avatar
                      userId={chat.peer!.userId}
                      name={chat.peer!.nick}
                      className="chan__face"
                    />
                  )}
                  <span className="chan__name">{chat.peer!.nick}</span>
                </button>
                <button
                  className="chan__forget"
                  onClick={() => {
                    forgetChannel(chat.channelId);
                    onChanged();
                  }}
                  title="Убрать из списка"
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="sidebar__section">
          <span className="sidebar__label">Голосовые каналы</span>

          {channelName !== null ? (
            <div className="chan chan--active">
              <SpeakerIcon size={16} className="chan__icon" />
              <span className="chan__name">{channelName}</span>
              <span className="chan__count">{participantCount}</span>
            </div>
          ) : null}

          {others.map((channel) => (
            <div key={channel.channelId} className="chan">
              <button
                className="chan__open"
                onClick={() => onOpenChannel(channel)}
                title={channel.code ? "Вернуться в канал" : "Ссылка утеряна"}
                disabled={!channel.code}
                type="button"
              >
                <SpeakerIcon size={16} className="chan__icon" />
                <span className="chan__name">{channel.name}</span>
              </button>
              <button
                className="chan__forget"
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

          {others.length === 0 ? (
            <p className="sidebar__empty">
              {channelName === null
                ? "Каналы появятся здесь, когда ты в них зайдёшь"
                : "Другие каналы появятся здесь, когда ты в них зайдёшь"}
            </p>
          ) : null}

          {/*
            Заводить каналы могут только вошедшие — иначе каталог разносится
            циклом в консоли. Гостю кнопку не показываем вовсе: предложение
            войти уже стоит ниже, в этой же колонке, и второе такое же рядом
            читалось бы как другое действие. На вход по чужой ссылке запрет не
            влияет — там кнопка и не нужна.
          */}
          {canCreate ? (
            <button className="sidebar__new" onClick={onNewChannel} type="button">
              <LinkIcon size={14} />
              Новый канал
            </button>
          ) : null}
        </div>
      </div>

      {/*
        Вход предлагаем только гостю и только если он настроен. Кнопка, которая
        приводит к «501 не настроено», хуже отсутствующей.
      */}
      {!account && loginAvailable ? (
        <a className="sidebar__login" href={loginUrl()}>
          <GoogleIcon size={15} />
          Войти через Google
        </a>
      ) : null}

      <div className="sidebar__me">
        {account?.avatarUrl ? (
          // Аватар от Google — обычная картинка, и она может не загрузиться.
          // Тогда остаётся то же место и те же инициалы, что у гостя.
          <img
            className="sidebar__avatar sidebar__avatar--photo"
            src={account.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          // Инициалы и цвет берём от того же, чьё имя написано рядом: иначе у
          // вошедшего под ником dumax в квадрате оставалось «ГО» от гостя.
          <Avatar
            userId={account?.id ?? selfIdentity}
            name={account?.nick ?? selfName}
            className="sidebar__avatar"
          />
        )}
        <div className="sidebar__identity">
          <span className="sidebar__myname">{account?.nick ?? selfName}</span>
          <span className="sidebar__mytag">
            {/*
              У гостя тег — обрезок локального идентификатора: он ничего не
              подтверждает и живёт только в этом браузере. У вошедшего — настоящий,
              выданный сервисом, и по нему человека можно найти.
            */}
            #{account?.tag ?? selfIdentity.slice(0, 4)}
          </span>
        </div>
        {account ? (
          <button
            className="sidebar__gear"
            onClick={onLogout}
            title={`Выйти из аккаунта ${account.nick}#${account.tag}`}
            type="button"
          >
            <ExitIcon size={16} />
          </button>
        ) : null}
        <button className="sidebar__gear" onClick={onOpenSettings} title="Настройки" type="button">
          <SlidersIcon size={16} />
        </button>
      </div>
    </aside>
  );
}
