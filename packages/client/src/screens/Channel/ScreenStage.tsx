import { useEffect, useRef, useState } from "react";
import type { ScreenShare } from "../../voice/VoiceEngine.ts";
import { ScreenIcon } from "../../components/Icons.tsx";

interface ScreenStageProps {
  screens: ScreenShare[];
  /** «Оглох» — значит и звук чужого экрана слышать не должен. */
  deafened: boolean;
}

/**
 * Чужой экран во весь канал.
 *
 * Занимает место сетки участников, а не встаёт рядом: показ смотрят, а плитки с
 * инициалами в это время не нужны — они уезжают в узкую полосу под ним (это
 * делает CSS канала).
 *
 * Смотреть начинают нажатием, а не сразу. Чужой экран — это чужой экран: он
 * прилетает без спроса посреди разговора, забирает собой всю сцену и тянет
 * трафик. Сначала карточка «такой-то показывает», и только по нажатию — видео.
 */
export function ScreenStage({ screens, deafened }: ScreenStageProps) {
  /** Чей показ мы согласились смотреть. `null` — пока ничей. */
  const [watching, setWatching] = useState<string | null>(null);

  const active = screens.find((s) => s.userId === watching) ?? null;
  /** Кого предлагаем посмотреть, пока не выбрали. */
  const offered = screens[0] ?? null;

  // Показывавший вышел — снимаем выбор, а не остаёмся на пустом месте.
  useEffect(() => {
    if (watching && !screens.some((s) => s.userId === watching)) setWatching(null);
  }, [screens, watching]);

  if (!active) {
    if (!offered) return null;
    return (
      <div className="share share--offer">
        <span className="share__tag">
          <i className="share__dot" />
          Показ экрана
        </span>
        <div className="share__ask">
          <span className="share__icon">
            <ScreenIcon size={26} />
          </span>
          <span className="share__who">
            <b>{offered.displayName}</b> показывает экран
          </span>
          <button
            className="share__watch"
            onClick={() => setWatching(offered.userId)}
            type="button"
          >
            Смотреть
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="share">
      <span className="share__tag">
        <i className="share__dot" />
        Показ экрана
      </span>
      {screens.length > 1 ? (
        <div className="share__tabs">
          {screens.map((screen) => (
            <button
              key={screen.userId}
              className={`share__tab${screen.userId === active.userId ? " share__tab--on" : ""}`}
              onClick={() => setWatching(screen.userId)}
              type="button"
            >
              {screen.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <ScreenVideo
        // key по человеку: при переключении между показами нужен новый элемент,
        // иначе Chrome иногда оставляет кадр от прошлого потока.
        key={active.userId}
        stream={active.stream}
        deafened={deafened}
      />

      <div className="share__by">Показывает {active.displayName}</div>
    </div>
  );
}

function ScreenVideo({ stream, deafened }: { stream: MediaStream; deafened: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  // srcObject нельзя выставить атрибутом — только свойством, отсюда и ref.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {
      // На iOS автозапуск со звуком запрещён до жеста. Картинка при этом идёт:
      // элемент помечен playsInline и без звука стартует сам.
    });
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      className="share__video"
      /*
        Звук экрана идёт мимо микшера — прямо через этот элемент. Микшер
        раздаёт голоса по людям, а показ это не человек; заводить ему запись в
        общем графе значило бы усложнить всё ради одного ползунка. Но
        «оглохнуть» обязано глушить и его, иначе оно врёт.
      */
      muted={deafened}
      // Без этого iOS открывает видео на весь экран поверх приложения.
      playsInline
      autoPlay
    />
  );
}
