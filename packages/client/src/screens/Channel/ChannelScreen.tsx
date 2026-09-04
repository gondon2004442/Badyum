import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchInviteCode, publicOrigin } from "../../api.ts";
import type { ConnectionQuality } from "../../voice/VoiceEngine.ts";
import { usePushToTalk, useVoice } from "../../voice/useVoice.ts";
import { Avatar } from "../../components/Avatar.tsx";
import {
  HeadphonesIcon,
  LinkIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenIcon,
  ScreenOffIcon,
  SpeakerIcon,
} from "../../components/Icons.tsx";
import { InviteTile } from "./InviteTile.tsx";
import { ScreenStage } from "./ScreenStage.tsx";
import { canShareScreen, describeScreenError } from "../../voice/screen.ts";
import { useAccount } from "../../account.ts";
import { Sidebar } from "./Sidebar.tsx";
import { ChatPanel } from "./ChatPanel.tsx";
import { PeoplePanel } from "./PeoplePanel.tsx";
import { SettingsPanel, savedInputDevice } from "./SettingsPanel.tsx";
import { ProfileMenu } from "./ProfileMenu.tsx";
import { AvatarPicker } from "../Home/AvatarPicker.tsx";
import { listInputDevices } from "../../voice/audio/devices.ts";
import {
  globalPushToTalkKey,
  isDesktop,
  notify,
  onGlobalPushToTalk,
  onOverlayToggle,
  setOverlay as setOverlayWindow,
} from "../../desktop.ts";
import { OverlayPanel } from "../Overlay/OverlayPanel.tsx";
import { report } from "../../report.ts";
import {
  denoiseEnabled,
  knownPeople,
  myIdentityId,
  recentChannels,
  rememberPerson,
  type RecentChannel,
} from "../../storage.ts";
import "./Channel.css";

interface ChannelScreenProps {
  channelId: string;
  channelName: string;
  token: string;
  selfName: string;
  onLeave: () => void;
  onOpenChannel: (channel: RecentChannel) => void;
  onNewChannel: () => void;
}

/** Что показывает правая колонка. На мобиле это же — переключатель вкладок. */
type Panel = "chat" | "people";

/** Порог, за которым канал и панель перестают помещаться рядом. */
const NARROW_QUERY = "(max-width: 720px)";

/**
 * Узкий ли экран.
 *
 * Нужен не для вёрстки (её делает CSS), а чтобы понимать, видно ли чат: на
 * телефоне открытая вкладка «Чат» ещё не значит, что он на экране.
 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === "function" && matchMedia(NARROW_QUERY).matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return narrow;
}

const PTT_KEY = "CapsLock";

export function ChannelScreen({
  channelId,
  channelName,
  token,
  selfName,
  onLeave,
  onOpenChannel,
  onNewChannel,
}: ChannelScreenProps) {
  const voice = useVoice();
  const account = useAccount();
  const [pttEnabled, setPttEnabled] = useState(false);
  const [joined, setJoined] = useState(false);
  const [globalKey, setGlobalKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("chat");
  /** Мобильная раскладка: канал и панели не помещаются рядом. */
  const [mobileView, setMobileView] = useState<"stage" | "panel">("stage");
  const isNarrow = useIsNarrow();
  const [storageTick, setStorageTick] = useState(0);
  /** Панель настроек. Строка, а не флаг: меню профиля открывает её на поле. */
  const [settingsOpen, setSettingsOpen] = useState<"name" | "device" | "all" | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  /** Выбор аватарки. Открывается из меню профиля — как и на домашнем экране. */
  const [pickingAvatar, setPickingAvatar] = useState(false);
  /** Как называется выбранный микрофон — для строки в меню профиля. */
  const [deviceName, setDeviceName] = useState<string | null>(null);
  /** Сколько сообщений было, когда чат последний раз смотрели. */
  const [seenCount, setSeenCount] = useState(0);
  /** Имя может меняться на лету, поэтому живёт в состоянии, а не в пропсе. */
  const [myName, setMyName] = useState(selfName);
  /**
   * Включал ли человек микрофон хоть раз за этот вход. Пока нет — держим
   * подсказку: вход замьюченным экономит чужие уши, но без объяснения читается
   * как «меня не слышат, всё сломалось».
   */
  const [everUnmuted, setEverUnmuted] = useState(false);
  /** Почему не вышло показать экран. Отказ в системном окне сюда не попадает. */
  const [shareProblem, setShareProblem] = useState<string | null>(null);
  /** Свёрнуты ли мы в панель поверх игры. Только в десктопной обёртке. */
  const [overlayOpen, setOverlayOpen] = useState(false);
  const overlayRef = useRef(false);
  const identity = myIdentityId();

  /**
   * Умеет ли браузер отдавать экран.
   *
   * Считаем один раз: ответ не меняется, а от него зависит, показывать ли
   * кнопку вовсе. Главный отказ — Safari на iPhone: показать оттуда нельзя,
   * смотреть чужой показ можно.
   */
  const canShare = useMemo(() => canShareScreen(), []);

  const toggleShare = async () => {
    setShareProblem(null);
    try {
      if (voice.self.sharing) await voice.stopScreenShare();
      else await voice.startScreenShare();
    } catch (error) {
      // null означает «человек нажал Отмена» — это не поломка, и говорить
      // ему об этом нечего.
      setShareProblem(describeScreenError(error));
    }
  };

  const recent = useMemo(() => recentChannels(), [storageTick, channelId]);
  /** Один в канале: пока это так, главное действие — позвать кого-нибудь. */
  const alone = voice.participants.length === 0;

  /*
    Кто в канале — для списка в сайдбаре.

    Себя добавляем последним и вручную: движок держит нас отдельно от
    собеседников, а в списке «кто здесь» человек ищет и себя тоже — иначе
    непонятно, засчитан ли твой вход вообще.
  */
  const people = useMemo(
    () => [
      ...voice.participants,
      {
        userId: voice.self.selfId ?? "self",
        identityId: identity,
        displayName: myName,
        avatarUrl: account.account?.avatarUrl ?? null,
        muted: voice.self.muted,
        deafened: voice.self.deafened,
        speaking: voice.self.speaking,
        sharing: voice.self.sharing,
      },
    ],
    [
      voice.participants,
      voice.self.selfId,
      voice.self.muted,
      voice.self.deafened,
      voice.self.speaking,
      voice.self.sharing,
      identity,
      myName,
      account.account?.avatarUrl,
    ],
  );

  /**
   * Чат виден, только когда открыта его вкладка — и на телефоне ещё и когда
   * показана панель, а не канал.
   */
  const chatVisible = panel === "chat" && (mobileView === "panel" || !isNarrow);
  const unread = Math.max(0, voice.messages.length - seenCount);

  // Пока чат перед глазами, непрочитанных быть не может.
  useEffect(() => {
    if (chatVisible) setSeenCount(voice.messages.length);
  }, [chatVisible, voice.messages.length]);
  const known = useMemo(() => knownPeople(), [storageTick, voice.participants.length]);

  // Встреченных запоминаем сразу: список «знакомых» строится только здесь,
  // на сервере никакой связи между сессиями нет.
  useEffect(() => {
    for (const participant of voice.participants) {
      rememberPerson({
        identityId: participant.identityId,
        displayName: participant.displayName,
        channelName,
      });
    }
  }, [voice.participants, channelName]);

  /*
    Название микрофона спрашиваем, только когда меню открыли.

    До первого getUserMedia браузер отдаёт устройства без имён, а спрашивать их
    при каждом рендере ради строки, которую человек видит раз в неделю, — лишняя
    работа на ровном месте.
  */
  useEffect(() => {
    if (!profileOpen) return;
    let cancelled = false;
    const saved = savedInputDevice();
    void listInputDevices()
      .then((list) => {
        if (cancelled) return;
        setDeviceName(list.find((d) => d.deviceId === saved)?.label ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profileOpen]);


  useEffect(() => {
    void voice
      .join(token, savedInputDevice(), true, denoiseEnabled())
      .then(() => setJoined(true))
      /*
        Отказ здесь уже обработан: useVoice поймал его и положил в voice.error,
        человек читает объяснение на экране. Бросает он дальше ради того, чтобы
        сюда не дошло setJoined — и это правильно, но без catch то же исключение
        всплывало необработанным отказом промиса. В браузере это строка в
        консоли, а у нас ещё и запись в сборе ошибок: отказ микрофона — случай
        частый и обычный, и заваливать им журнал значит перестать его читать.
      */
      .catch(() => {});
    // Токен одноразовый: повторный join по нему невозможен и не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Берём метод движка напрямую: он стабилен между рендерами. Обёртка через
  // useCallback([voice]) меняла бы личность на каждый рендер, эффект ниже
  // пересоздавался бы вместе с ней и подписка на хоткей не успевала закрепиться.
  const onTransmitChange = voice.setTransmitting;

  // В десктопной обёртке рация системная и работает поверх игры; в браузере
  // остаётся клавиша, но только пока вкладка в фокусе.
  const desktop = isDesktop();
  usePushToTalk(pttEnabled && !desktop ? PTT_KEY : null, onTransmitChange);

  useEffect(() => {
    if (!desktop) return;
    void globalPushToTalkKey().then(setGlobalKey);
  }, [desktop]);

  useEffect(() => {
    if (!desktop || !pttEnabled) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    onTransmitChange(false);
    void onGlobalPushToTalk(onTransmitChange).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      // Выключили рацию — микрофон обязан вернуться в обычный режим, иначе
      // человек молчит и не понимает почему.
      onTransmitChange(true);
    };
  }, [desktop, pttEnabled, onTransmitChange]);

  /**
   * Переключить панель поверх игры.
   *
   * Ref, а не только состояние: обработчик подписывается один раз и должен
   * знать текущее значение, не пересоздаваясь на каждое переключение.
   *
   * Панель показываем только после того, как окно действительно стало панелью.
   * Наоборот было бы хуже всего: обычный экран, обрезанный до 340 пикселей,
   * выглядит как сломавшееся приложение.
   */
  const toggleOverlay = useCallback(() => {
    const next = !overlayRef.current;

    void setOverlayWindow(next)
      .then(() => {
        overlayRef.current = next;
        setOverlayOpen(next);
      })
      .catch((error) => report("overlay", error));
  }, []);

  useEffect(() => {
    if (!desktop) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void onOverlayToggle(toggleOverlay).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktop, toggleOverlay]);

  /*
    Выходя из канала, обязательно возвращаем окно.

    Иначе человек, вышедший прямо из панели, остаётся с крошечным окном без
    рамки, в котором открыт домашний экран, — и вернуть его нечем, потому что
    клавиша панели работает только в канале.
  */
  useEffect(
    () => () => {
      if (overlayRef.current) {
        overlayRef.current = false;
        void setOverlayWindow(false).catch((error) => report("overlay-restore", error));
      }
    },
    [],
  );

  /*
    Уведомление системы о новом сообщении.

    Заводится вместе со сворачиванием окна в трей: раньше закрытое окно
    означало закрытое приложение, а теперь оно живёт дальше, и без уведомления
    человек просто не узнает, что ему написали.

    Отметку держим в ref, а не в состоянии: она не влияет на то, что нарисовано,
    и лишний перерисовки от неё не нужно.
  */
  const notified = useRef<number | null>(null);

  useEffect(() => {
    if (!desktop) return;

    const count = voice.messages.length;

    /*
      Первый заход — не повод уведомлять.

      При входе в канал приезжает вся история разом, и без этой отсечки человек
      получил бы залп уведомлений о разговоре, который шёл без него.
    */
    if (notified.current === null) {
      notified.current = count;
      return;
    }

    const previous = notified.current;
    notified.current = count;
    if (count <= previous) return;

    // Окно на виду — человек и так всё видит, уведомление было бы шумом.
    if (typeof document !== "undefined" && document.hasFocus()) return;

    // Свои сообщения не считаются, о них уведомлять некого.
    const last = voice.messages
      .slice(previous)
      .filter((message) => message.userId !== voice.self.selfId)
      .at(-1);
    if (!last) return;

    void notify(
      `${last.displayName} — ${channelName}`,
      // Картинка без подписи — обычное сообщение, и текста у неё нет.
      last.text || "Прислал картинку",
    );
  }, [desktop, voice.messages, voice.self.selfId, channelName]);

  const leave = async () => {
    await voice.leave();
    onLeave();
  };

  const total = voice.participants.length + 1;

  /** Кто как выглядит — для переписки. Себя тоже: свои сообщения там же. */
  const avatars = useMemo(() => {
    const map = new Map<string, string | null>(
      voice.participants.map((p) => [p.userId, p.avatarUrl]),
    );
    if (voice.self.selfId) map.set(voice.self.selfId, account.account?.avatarUrl ?? null);
    return map;
  }, [voice.participants, voice.self.selfId, account.account?.avatarUrl]);

  /*
    Панель поверх игры — другая разметка того же компонента, а не другой экран.

    Это принципиально. Отдай мы панель отдельному компоненту выше по дереву,
    React размонтировал бы ChannelScreen вместе с useVoice, а тот держит
    соединения, микрофон и звуковой граф. Разговор оборвался бы ровно в тот
    момент, ради которого панель и заводилась.
  */
  if (overlayOpen) {
    return (
      <OverlayPanel
        voice={voice}
        channelId={channelId}
        channelName={channelName}
        selfName={myName}
        selfAvatarUrl={account.account?.avatarUrl ?? null}
        avatars={avatars}
        onCollapse={toggleOverlay}
        onLeave={() => void leave()}
      />
    );
  }

  return (
    <div className="shell">
      <Sidebar
        channelName={channelName}
        channelId={channelId}
        selfName={myName}
        selfIdentity={identity}
        participantCount={total}
        recent={recent}
        onOpenChannel={onOpenChannel}
        onNewChannel={onNewChannel}
        onChanged={() => setStorageTick((t) => t + 1)}
        people={people}
        account={account.account}
        loginAvailable={account.available}
        onOpenProfile={() => setProfileOpen(true)}
      />

      {profileOpen ? (
        <ProfileMenu
          account={account.account}
          selfName={myName}
          selfIdentity={identity}
          loginAvailable={account.available}
          loggingIn={account.loggingIn}
          sound={{
            deviceName,
            denoised: voice.self.denoised,
            onDenoise: (on) => void voice.setDenoise(on),
            openSettings: (focus) => setSettingsOpen(focus ?? "all"),
          }}
          /*
            Панель поверх игры показываем только там, где она бывает: в
            десктопной обёртке. Тумблер, который не сработает, хуже
            отсутствующего.
          */
          overlay={desktop ? { on: overlayOpen, toggle: toggleOverlay } : null}
          onPickAvatar={account.account ? () => setPickingAvatar(true) : undefined}
          onLogout={() => void account.logout()}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}

      {pickingAvatar && account.account ? (
        <AvatarPicker
          account={account.account}
          onClose={() => setPickingAvatar(false)}
          onChanged={account.setAvatar}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          focus={settingsOpen === "all" ? undefined : settingsOpen}
          selfName={myName}
          onClose={() => setSettingsOpen(null)}
          onRename={(name) => {
            voice.rename(name);
            setMyName(name);
          }}
          onPickDevice={voice.setInputDevice}
          denoised={voice.self.denoised}
          onDenoise={voice.setDenoise}
        />
      ) : null}

      <div className={`channel channel--${mobileView}`}>
      <header className="channel__header">
        <div className="channel__identity">
          <SpeakerIcon className="channel__icon" />
          <span className="channel__name">{channelName}</span>
          <span className="channel__dot" />
          <span className="channel__count">
            {total} {plural(total, "в канале", "в канале", "в канале")}
          </span>
        </div>
        <div className="channel__spacer" />
        <QualityPill quality={voice.quality} />
        <button
          className="btn-invite"
          onClick={() => void copyInvite(channelId)}
          title="Скопировать ссылку-приглашение"
          type="button"
        >
          <LinkIcon />
          <span>Позвать</span>
        </button>
      </header>

      <StatusBanner quality={voice.quality} error={voice.error} joined={joined} />

      {voice.screens.length > 0 ? (
        <ScreenStage screens={voice.screens} deafened={voice.self.deafened} />
      ) : null}

      <main className={`stage${voice.screens.length > 0 ? " stage--aside" : ""}`}>
        <Tile
          userId="self"
          name={`${myName} (ты)`}
          avatarUrl={account.account?.avatarUrl}
          speaking={voice.self.speaking}
          muted={voice.self.muted}
          isSelf
        />
        {voice.participants.map((participant) => (
          <Tile
            key={participant.userId}
            userId={participant.userId}
            name={participant.displayName}
            avatarUrl={participant.avatarUrl}
            speaking={participant.speaking}
            muted={participant.muted}
            volume={participant.volume}
            onVolume={(v) => voice.setParticipantVolume(participant.userId, v)}
          />
        ))}
        {/*
          Позвать — плиткой, пока ты один.

          В макете её нет вовсе: там канал на четверых, звать некого. Но пока в
          канале один человек, это главное, что он может сделать, и прятать
          приглашение за кнопкой в шапке значит заставить его искать. Как только
          кто-то вошёл, плитка уходит и сцена остаётся людям.
        */}
        {alone && voice.screens.length === 0 ? <InviteTile channelId={channelId} /> : null}
      </main>

      {shareProblem ? (
        <div className="sharehint" role="status">
          {shareProblem}
        </div>
      ) : null}

      {joined && voice.self.muted && !everUnmuted ? (
        <button
          className="mutehint"
          onClick={() => {
            setEverUnmuted(true);
            voice.setMuted(false);
          }}
          type="button"
        >
          <MicOffIcon size={14} />
          <span>
            Микрофон выключен — <b>нажми, чтобы говорить</b>
          </span>
        </button>
      ) : null}

      <footer className="controls">
        {/*
          Рация — переключатель, а не форма с галочкой и двумя подписями.

          Объяснение переехало в подсказку: в браузере оно важное — клавиша
          работает только в активной вкладке, — но занимать им треть дока
          несоразмерно тому, как часто его читают.
        */}
        <button
          className={`ptt${pttEnabled ? " ptt--on" : ""}`}
          onClick={() => setPttEnabled((on) => !on)}
          aria-pressed={pttEnabled}
          title={
            desktop
              ? "Рация: говоришь, пока клавиша зажата. Работает поверх игры"
              : "Рация: говоришь, пока клавиша зажата. В браузере — только когда вкладка активна"
          }
          type="button"
        >
          <span className="ptt__label">Рация</span>
          <span className="ptt__key">{globalKey ?? "CAPS"}</span>
        </button>

        <div className="controls__group">
          {/* При включённой рации микрофон не выключен, но и не передаёт.
              Без отдельного состояния человек говорит в пустоту и не понимает,
              почему его не слышат. */}
          <button
            className={`ctrl ${
              voice.self.muted
                ? ""
                : voice.self.transmitting
                  ? "ctrl--on"
                  : "ctrl--armed"
            }`}
            onClick={() => {
              if (voice.self.muted) setEverUnmuted(true);
              voice.setMuted(!voice.self.muted);
            }}
            title={
              voice.self.muted
                ? "Включить микрофон"
                : voice.self.transmitting
                  ? "Выключить микрофон"
                  : `Рация: зажми ${globalKey ?? PTT_KEY}`
            }
            type="button"
          >
            {voice.self.muted ? <MicOffIcon /> : <MicIcon />}
          </button>

          <button
            className={`ctrl ${voice.self.deafened ? "ctrl--danger" : ""}`}
            onClick={() => voice.setDeafened(!voice.self.deafened)}
            title={voice.self.deafened ? "Включить звук" : "Оглохнуть"}
            type="button"
          >
            <HeadphonesIcon />
          </button>

          {/* Кнопки нет вовсе там, где показать нельзя: она бы молча не
              срабатывала, и человек решил бы, что сломалось приложение. */}
          {canShare ? (
            <button
              className={`ctrl ${voice.self.sharing ? "ctrl--on" : ""}`}
              onClick={() => void toggleShare()}
              title={voice.self.sharing ? "Остановить показ" : "Показать экран"}
              type="button"
            >
              {voice.self.sharing ? <ScreenOffIcon /> : <ScreenIcon />}
            </button>
          ) : null}

          {/*
            Выход — такая же круглая кнопка, как остальные, только красная.

            Текстовой он был шире всех и стоял особняком, хотя это действие того
            же ряда: положить трубку. Красный цвет и значок говорят достаточно,
            а подпись остаётся во всплывающей подсказке.
          */}
          <button
            className="ctrl ctrl--leave"
            onClick={() => void leave()}
            title="Выйти из канала"
            type="button"
          >
            <PhoneOffIcon />
          </button>
        </div>

        <div className="controls__right">
          {/* На мобиле это переключатель между каналом и панелью: рядом они
              не помещаются, а прятать чат совсем — терять половину смысла. */}
          <button
            className="panel-toggle"
            onClick={() => setMobileView((v) => (v === "stage" ? "panel" : "stage"))}
            type="button"
          >
            {mobileView === "stage" ? "Чат" : "Канал"}
            {mobileView === "stage" && unread > 0 ? (
              <span className="side__badge">{unread > 99 ? "99+" : unread}</span>
            ) : null}
          </button>
        </div>
      </footer>
      </div>

      <div className={`side side--${mobileView === "panel" ? "open" : "closed"}`}>
        <div className="side__tabs">
          <button
            className={`side__tab ${panel === "chat" ? "side__tab--on" : ""}`}
            onClick={() => setPanel("chat")}
            type="button"
          >
            Чат
            {unread > 0 ? <span className="side__badge">{unread > 99 ? "99+" : unread}</span> : null}
          </button>
          <button
            className={`side__tab ${panel === "people" ? "side__tab--on" : ""}`}
            onClick={() => setPanel("people")}
            type="button"
          >
            Люди
          </button>
          <button
            className="side__back"
            onClick={() => setMobileView("stage")}
            type="button"
          >
            К каналу
          </button>
        </div>

        {panel === "chat" ? (
          <ChatPanel
            messages={voice.messages}
            selfId={voice.self.selfId}
            onSend={voice.sendChat}
            typing={voice.typing}
            onTyping={voice.setTyping}
            onUpload={voice.uploadFile}
            channelId={channelId}
            avatars={avatars}
          />
        ) : (
          <PeoplePanel
            participants={voice.participants}
            selfName={myName}
            selfIdentity={identity}
            selfSpeaking={voice.self.speaking}
            selfMuted={voice.self.muted}
            known={known}
            onChanged={() => setStorageTick((t) => t + 1)}
          />
        )}
      </div>
    </div>
  );
}

interface TileProps {
  userId: string;
  name: string;
  /** Картинка человека. Нет — остаются инициалы, и это нормальный вид. */
  avatarUrl?: string | null;
  speaking: boolean;
  muted: boolean;
  isSelf?: boolean;
  volume?: number;
  onVolume?: (value: number) => void;
}

function Tile({ userId, name, avatarUrl, speaking, muted, isSelf, volume, onVolume }: TileProps) {
  return (
    <div className="tile">
      <div className={`tile__ring ${speaking ? "tile__ring--speaking" : ""}`}>
        <Avatar
          userId={userId}
          name={name}
          src={avatarUrl}
          className={`tile__avatar ${muted ? "tile__avatar--muted" : ""}`}
        />
      </div>

      <span className={`tile__name ${muted ? "tile__name--dim" : ""}`}>{name}</span>

      <span
        className={`tile__status ${
          muted ? "tile__status--muted" : speaking ? "tile__status--speaking" : ""
        }`}
      >
        {muted ? <MicOffIcon size={12} /> : <MicIcon size={12} />}
        {muted ? "мик выкл" : speaking ? "говорит" : "в канале"}
      </span>

      {!isSelf && onVolume ? (
        <input
          className="tile__volume"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={volume ?? 1}
          onChange={(e) => onVolume(Number(e.target.value))}
          aria-label={`Громкость ${name}`}
        />
      ) : null}
    </div>
  );
}

/**
 * Индикатор связи. Зелёный, только когда связь действительно хорошая: врать
 * здесь означает, что пользователь будет искать проблему в наушниках.
 */
function QualityPill({ quality }: { quality: ConnectionQuality }) {
  const { rttMs, packetLoss } = quality;

  const level =
    rttMs === null
      ? 0
      : (packetLoss ?? 0) > 0.05 || rttMs > 250
        ? 1
        : rttMs > 120
          ? 2
          : 3;

  const tone = level >= 3 ? "good" : level === 2 ? "fair" : level === 1 ? "poor" : "fair";
  const label = rttMs === null ? "--- мс" : `${rttMs} мс`;

  return (
    <span className={`quality quality--${tone}`} title={quality.relayed ? "через relay" : ""}>
      <span className="quality__bars">
        {[1, 2, 3].map((bar) => (
          <span key={bar} className={`quality__bar ${level >= bar ? "quality__bar--on" : ""}`} />
        ))}
      </span>
      {label}
    </span>
  );
}

/** При проблемах молчать нельзя — иначе тишина выглядит как поломка наушников. */
function StatusBanner({
  quality,
  error,
  joined,
}: {
  quality: ConnectionQuality;
  error: string | null;
  joined: boolean;
}) {
  if (error) return <div className="banner banner--error">{error}</div>;

  if (quality.status === "reconnecting") {
    return <div className="banner banner--warn">Связь пропала — переподключаюсь…</div>;
  }
  if (quality.status === "failed") {
    return <div className="banner banner--error">Не удалось подключиться к каналу</div>;
  }
  if (!joined || quality.status === "connecting") {
    return <div className="banner banner--warn">Подключаюсь…</div>;
  }
  return null;
}

async function copyInvite(channelId: string): Promise<void> {
  const { code } = await fetchInviteCode(channelId);
  await navigator.clipboard.writeText(`${publicOrigin()}/j/${code}`).catch(() => {});
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
