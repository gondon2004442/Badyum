/**
 * Меню профиля: кто я и всё, что меняют чаще всего.
 *
 * Раскрывается от строки профиля в углу сайдбара. Раньше эти вещи были
 * растащены: аватарка пряталась за кликом по картинке, выход стоял иконкой
 * рядом с шестерёнкой и кричал так же громко, хотя нужен раз в жизни, а
 * шумодав жил в отдельной панели вместе с хоткеями.
 *
 * Разделение с панелью настроек такое: здесь — личность и то, что переключают
 * на ходу; там — полный набор, включая клавиши и автозапуск. Строки «микрофон»
 * и «сменить имя» открывают ту же панель, но сразу на нужном поле: иначе они
 * дублировали бы строку «Настройки» и человек не понимал бы, чем они разные.
 */
import { useEffect, useRef } from "react";
import {
  BadgeIcon,
  CameraIcon,
  ExitIcon,
  GoogleIcon,
  MicIcon,
  NoiseIcon,
  OverlayIcon,
  SlidersIcon,
  VerifiedIcon,
} from "../../components/Icons.tsx";
import { Avatar } from "../../components/Avatar.tsx";
import { handleOf, nameOf, startLogin, type Account } from "../../account.ts";
import "./Profile.css";

export interface ProfileMenuProps {
  account: Account | null;
  selfName: string;
  selfIdentity: string;
  loginAvailable: boolean;
  loggingIn: boolean;
  /**
   * Звук. `null` — мы не в канале.
   *
   * Вне канала этих строк нет вовсе, и это не упрощение ради краткости: панель
   * настроек по своему устройству применяет всё немедленно — имя уходит в
   * канал сообщением, микрофон подменяется в живых соединениях. Показать её
   * там, где менять нечего, значило бы предложить настройку, которая ничего не
   * делает.
   */
  sound: {
    /** Как называется выбранный микрофон. Пусто — система решает сама. */
    deviceName: string | null;
    denoised: boolean;
    onDenoise: (on: boolean) => void;
    openSettings: (focus?: "name" | "device") => void;
  } | null;
  /** Панель поверх игры. `null` — мы не в приложении или не в канале. */
  overlay: { on: boolean; toggle: () => void } | null;
  onPickAvatar?: () => void;
  onLogout: () => void;
  onClose: () => void;
}

export function ProfileMenu({
  account,
  selfName,
  selfIdentity,
  loginAvailable,
  loggingIn,
  sound,
  overlay,
  onPickAvatar,
  onLogout,
  onClose,
}: ProfileMenuProps) {
  const card = useRef<HTMLDivElement>(null);

  /*
    Закрывается по клику мимо и по Escape.

    Меню раскрывается над содержимым и перехватывает внимание: не дать закрыть
    его привычным движением значит запереть человека в нём. Слушаем на нажатии,
    а не на клике: иначе кнопка под курсором успевает сработать раньше.
  */
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!card.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const go = (run: () => void) => () => {
    run();
    onClose();
  };

  return (
    <div className="profile" role="dialog" aria-label="Профиль">
      <div className="profile__card" ref={card}>
        <div className="profile__who">
          <Avatar
            userId={account?.id ?? selfIdentity}
            name={account ? nameOf(account) : selfName}
            src={account?.avatarUrl}
            className="profile__face"
          />
          <span className="profile__id">
            <span className="profile__name">{account ? nameOf(account) : selfName}</span>
            <span className="profile__tag">
              {account ? (handleOf(account) ?? "юз не выбран") : `#${selfIdentity.slice(0, 4)}`}
            </span>
          </span>
          {/* Через что вошёл. Гостю показывать нечего — он никуда не входил. */}
          {account ? (
            <span className="profile__via">
              <VerifiedIcon size={13} />
              GOOGLE
            </span>
          ) : null}
        </div>

        {sound ? (
          <>
            <span className="profile__line" />
            <div className="profile__group">
              <span className="profile__label">Чем говоришь</span>
              <button
                className="profile__row"
                onClick={go(() => sound.openSettings("device"))}
                type="button"
              >
                <MicIcon size={18} className="profile__icon" />
                <span className="profile__text">
                  {sound.deviceName ?? "Микрофон по умолчанию"}
                </span>
              </button>
            </div>
          </>
        ) : null}

        <span className="profile__line" />

        <div className="profile__group">
          {account && onPickAvatar ? (
            <button className="profile__row" onClick={go(onPickAvatar)} type="button">
              <CameraIcon size={18} className="profile__icon" />
              <span className="profile__text">Сменить аватарку</span>
            </button>
          ) : null}

          {sound ? (
            <>
              <button
                className="profile__row"
                onClick={go(() => sound.openSettings("name"))}
                type="button"
              >
                <BadgeIcon size={18} className="profile__icon" />
                <span className="profile__text">Сменить имя</span>
              </button>

              <button
                className="profile__row"
                onClick={() => sound.onDenoise(!sound.denoised)}
                aria-pressed={sound.denoised}
                type="button"
              >
                <NoiseIcon size={18} className="profile__icon" />
                <span className="profile__text">Шумодав</span>
                <span className={`toggle${sound.denoised ? " toggle--on" : ""}`} />
              </button>
            </>
          ) : null}

          {/*
            Панель поверх игры — только там, где она существует: в приложении и
            в канале. В браузере окно не ужать, а вне канала показывать нечего.
          */}
          {overlay ? (
            <button
              className="profile__row"
              onClick={overlay.toggle}
              aria-pressed={overlay.on}
              type="button"
            >
              <OverlayIcon size={18} className="profile__icon" />
              <span className="profile__text">Панель поверх игры</span>
              <span className={`toggle${overlay.on ? " toggle--on" : ""}`} />
            </button>
          ) : null}

          {sound ? (
            <button
              className="profile__row"
              onClick={go(() => sound.openSettings())}
              type="button"
            >
              <SlidersIcon size={18} className="profile__icon" />
              <span className="profile__text">Настройки</span>
            </button>
          ) : null}
        </div>

        <span className="profile__line" />

        <div className="profile__foot">
          {/*
            Не номер версии, а отпечаток сборки: номер в клиенте никто не ведёт,
            и показывать вечную «0.1.0» значит врать. Отпечаток же говорит ровно
            то, что нужно при разборе поломки, — какой именно код перед нами.
          */}
          <span className="profile__build">{__BADYUM_BUILD__}</span>
          {account ? (
            <button className="profile__out" onClick={go(onLogout)} type="button">
              <ExitIcon size={16} />
              Выйти
            </button>
          ) : loginAvailable ? (
            <button
              className="profile__in"
              onClick={() => void startLogin()}
              disabled={loggingIn}
              type="button"
            >
              <GoogleIcon size={15} />
              {loggingIn ? "Жду Google…" : "Войти"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
