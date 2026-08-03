import {
  ExitIcon,
  GoogleIcon,
  LinkIcon,
  SlidersIcon,
  SpeakerIcon,
} from "../../components/Icons.tsx";
import { Avatar } from "../../components/Avatar.tsx";
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
  onNewChannel,
  onChanged,
  onOpenSettings,
  account,
  loginAvailable,
  onLogout,
}: SidebarProps) {
  const others = recent.filter((c) => c.channelId !== channelId);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__mark">B</span>
        <span className="sidebar__wordmark">BADYUM</span>
      </div>

      <div className="sidebar__scroll">
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

          <button className="sidebar__new" onClick={onNewChannel} type="button">
            <LinkIcon size={14} />
            Новый канал
          </button>
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
