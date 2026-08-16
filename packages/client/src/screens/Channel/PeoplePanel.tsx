import type { VoiceParticipant } from "../../voice/VoiceEngine.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { MicIcon, MicOffIcon } from "../../components/Icons.tsx";
import { forgetPerson, type KnownPerson } from "../../storage.ts";

interface PeoplePanelProps {
  participants: VoiceParticipant[];
  selfName: string;
  selfIdentity: string;
  selfSpeaking: boolean;
  selfMuted: boolean;
  known: KnownPerson[];
  onChanged: () => void;
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
 * Кто здесь и кого ты уже встречал.
 *
 * «Знакомые» — память этого браузера, а не список друзей на сервере: аккаунтов
 * пока нет. Опознание держится на идентификаторе, который собеседник присылает
 * сам, поэтому это подсказка «кажется, мы уже говорили», а не подтверждённая
 * личность.
 */
export function PeoplePanel({
  participants,
  selfName,
  selfIdentity,
  selfSpeaking,
  selfMuted,
  known,
  onChanged,
}: PeoplePanelProps) {
  const hereIdentities = new Set(
    participants.map((p) => p.identityId).filter((id): id is string => id !== null),
  );
  const elsewhere = known.filter((p) => !hereIdentities.has(p.identityId));

  return (
    <section className="people">
      <div className="people__section">
        <span className="people__label">В канале — {participants.length + 1}</span>

        <div className="person">
          <Avatar userId={selfIdentity} name={selfName} className="person__avatar" />
          <div className="person__body">
            <span className="person__name">{selfName}</span>
            <span className="person__note">это ты</span>
          </div>
          {selfMuted ? (
            <MicOffIcon size={14} className="person__mic person__mic--off" />
          ) : (
            <MicIcon
              size={14}
              className={`person__mic ${selfSpeaking ? "person__mic--live" : ""}`}
            />
          )}
        </div>

        {participants.map((participant) => (
          <div key={participant.userId} className="person">
            <Avatar
              userId={participant.identityId ?? participant.userId}
              name={participant.displayName}
              src={participant.avatarUrl}
              className="person__avatar"
              dimmed={participant.muted}
            />
            <div className="person__body">
              <span className="person__name">{participant.displayName}</span>
              <span className="person__note">
                {participant.muted
                  ? "микрофон выключен"
                  : participant.speaking
                    ? "говорит"
                    : "слушает"}
              </span>
            </div>
            {participant.muted ? (
              <MicOffIcon size={14} className="person__mic person__mic--off" />
            ) : (
              <MicIcon
                size={14}
                className={`person__mic ${participant.speaking ? "person__mic--live" : ""}`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="people__section">
        <span className="people__label">Знакомые</span>

        {elsewhere.length === 0 ? (
          <p className="people__empty">
            Здесь появятся те, с кем ты уже говорил. Список хранится только в
            этом браузере.
          </p>
        ) : (
          elsewhere.map((person) => (
            <div key={person.identityId} className="person person--past">
              <Avatar
                userId={person.identityId}
                name={person.displayName}
                className="person__avatar"
                dimmed
              />
              <div className="person__body">
                <span className="person__name">{person.displayName}</span>
                <span className="person__note">
                  {person.lastChannel} · {ago(person.lastSeen)}
                </span>
              </div>
              <button
                className="person__forget"
                onClick={() => {
                  forgetPerson(person.identityId);
                  onChanged();
                }}
                title="Забыть"
                type="button"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
