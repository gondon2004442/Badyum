import { useEffect, useMemo, useState } from "react";
import { fetchInviteCode, publicOrigin } from "../../api.ts";
import type { ConnectionQuality } from "../../voice/VoiceEngine.ts";
import { usePushToTalk, useVoice } from "../../voice/useVoice.ts";
import { Avatar } from "../../components/Avatar.tsx";
import {
  ExitIcon,
  HeadphonesIcon,
  LinkIcon,
  MicIcon,
  MicOffIcon,
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
import { globalPushToTalkKey, isDesktop, onGlobalPushToTalk } from "../../desktop.ts";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  useEffect(() => {
    void voice.join(token, savedInputDevice(), true, denoiseEnabled()).then(() =>
      setJoined(true),
    );
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

  const leave = async () => {
    await voice.leave();
    onLeave();
  };

  const total = voice.participants.length + 1;

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
        account={account.account}
        loginAvailable={account.available}
        onLogout={() => void account.logout()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {settingsOpen ? (
        <SettingsPanel
          selfName={myName}
          onClose={() => setSettingsOpen(false)}
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
          speaking={voice.self.speaking}
          muted={voice.self.muted}
          isSelf
        />
        {voice.participants.map((participant) => (
          <Tile
            key={participant.userId}
            userId={participant.userId}
            name={participant.displayName}
            speaking={participant.speaking}
            muted={participant.muted}
            volume={participant.volume}
            onVolume={(v) => voice.setParticipantVolume(participant.userId, v)}
          />
        ))}
        {voice.screens.length === 0 ? <InviteTile channelId={channelId} /> : null}
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
        <div className="ptt">
          <span className="ptt__label">Рация</span>
          <label className="ptt__row">
            <input
              type="checkbox"
              checked={pttEnabled}
              onChange={(e) => setPttEnabled(e.target.checked)}
            />
            <span className="ptt__key">{globalKey ?? "CAPS"}</span>
            удерживай
          </label>
          <span className="ptt__note">
            {desktop ? "работает поверх игры" : "только когда вкладка активна"}
          </span>
        </div>

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

          <button className="ctrl ctrl--leave" onClick={() => void leave()} type="button">
            <ExitIcon />
            <span>Выйти</span>
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
  speaking: boolean;
  muted: boolean;
  isSelf?: boolean;
  volume?: number;
  onVolume?: (value: number) => void;
}

function Tile({ userId, name, speaking, muted, isSelf, volume, onVolume }: TileProps) {
  return (
    <div className="tile">
      <div className={`tile__ring ${speaking ? "tile__ring--speaking" : ""}`}>
        <Avatar
          userId={userId}
          name={name}
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
