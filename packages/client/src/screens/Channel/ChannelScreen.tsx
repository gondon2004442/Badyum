import { useCallback, useEffect, useState } from "react";
import { fetchInviteCode } from "../../api.ts";
import type { ConnectionQuality } from "../../voice/VoiceEngine.ts";
import { usePushToTalk, useVoice } from "../../voice/useVoice.ts";
import { Avatar } from "../../components/Avatar.tsx";
import {
  ExitIcon,
  HeadphonesIcon,
  LinkIcon,
  MicIcon,
  MicOffIcon,
  SpeakerIcon,
} from "../../components/Icons.tsx";
import { InviteTile } from "./InviteTile.tsx";
import "./Channel.css";

interface ChannelScreenProps {
  channelId: string;
  channelName: string;
  token: string;
  selfName: string;
  onLeave: () => void;
}

const PTT_KEY = "CapsLock";

export function ChannelScreen({
  channelId,
  channelName,
  token,
  selfName,
  onLeave,
}: ChannelScreenProps) {
  const voice = useVoice();
  const [pttEnabled, setPttEnabled] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    void voice.join(token).then(() => setJoined(true));
    // Токен одноразовый: повторный join по нему невозможен и не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const onTransmitChange = useCallback(
    (on: boolean) => voice.setTransmitting(on),
    [voice],
  );
  usePushToTalk(pttEnabled ? PTT_KEY : null, onTransmitChange);

  const leave = async () => {
    await voice.leave();
    onLeave();
  };

  const total = voice.participants.length + 1;

  return (
    <div className="channel">
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

      <main className="stage">
        <Tile
          userId="self"
          name={`${selfName} (ты)`}
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
        <InviteTile channelId={channelId} />
      </main>

      <footer className="controls">
        <div className="ptt">
          <span className="ptt__label">Рация</span>
          <label className="ptt__row">
            <input
              type="checkbox"
              checked={pttEnabled}
              onChange={(e) => setPttEnabled(e.target.checked)}
            />
            <span className="ptt__key">CAPS</span>
            удерживай
          </label>
        </div>

        <div className="controls__group">
          <button
            className={`ctrl ${voice.self.muted ? "" : "ctrl--on"}`}
            onClick={() => voice.setMuted(!voice.self.muted)}
            title={voice.self.muted ? "Включить микрофон" : "Выключить микрофон"}
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

          <button className="ctrl ctrl--leave" onClick={() => void leave()} type="button">
            <ExitIcon />
            <span>Выйти</span>
          </button>
        </div>

        <div className="controls__right" />
      </footer>
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
          className={`tile__avatar ${muted ? "tile__avatar--muted" : ""}`}
        />
      </div>

      <span className={`tile__name ${muted ? "tile__name--dim" : ""}`}>{name}</span>

      <span
        className={`tile__status ${
          muted ? "tile__status--muted" : speaking ? "tile__status--speaking" : ""
        }`}
      >
        {muted ? <MicOffIcon size={13} /> : <MicIcon size={13} />}
        {muted ? "микрофон выкл" : speaking ? "говорит" : "в канале"}
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
  const label = rttMs === null ? "…" : `${rttMs} мс`;

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
  await navigator.clipboard.writeText(`${location.origin}/j/${code}`).catch(() => {});
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
