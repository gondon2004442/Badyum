/**
 * Аватар: своя картинка, если она есть, иначе инициалы.
 *
 * Развилка живёт здесь, а не в каждом вызывающем: раньше она была продублирована
 * в сайдбаре, контактах и переписке, и стоило добавить картинку в четвёртом
 * месте — про неё забывали.
 *
 * Инициалы не запасной вариант, а полноценный: у гостя аккаунта нет вовсе, а
 * участник всё равно должен опознаваться с одного взгляда — одинаковые серые
 * кружки в канале на шесть человек бесполезны. Цвет выводится из userId,
 * поэтому один и тот же человек всегда одного цвета.
 *
 * Здесь же адрес картинки доводится до абсолютного. Это единственное место, где
 * аватарка становится тегом img, — значит и единственное, где промах виден
 * сразу; разложи мы это по девяти вызывающим, десятый снова забыли бы.
 */
import { mediaUrl } from "../api.ts";

const ACCENTS = [
  "var(--accent-lime)",
  "var(--accent-mint)",
  "var(--status-warn)",
  "#6b8cfa",
  "#ff7ac6",
  "#4fd1ff",
];

function hash(input: string): number {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(value);
}

export function accentFor(userId: string): string {
  return ACCENTS[hash(userId) % ACCENTS.length] ?? ACCENTS[0]!;
}

/** Две буквы без служебного хвоста вида «(ты)». */
function initialsOf(name: string): string {
  const clean = name.replace(/\s*\(.*\)\s*$/, "").trim();
  return (clean.slice(0, 2) || "??").toUpperCase();
}

interface AvatarProps {
  userId: string;
  name: string;
  /** Картинка человека. `null` или пусто — рисуем инициалы. */
  src?: string | null;
  size?: number;
  dimmed?: boolean;
  className?: string;
}

export function Avatar({ userId, name, src, size, dimmed, className }: AvatarProps) {
  const accent = accentFor(userId);
  const url = mediaUrl(src);

  if (url) {
    return (
      <img
        className={className}
        data-avatar=""
        src={url}
        alt=""
        /*
          Аватарка бывает с чужого домена (Google), и туда не должно уезжать,
          с какой страницы её попросили.
        */
        referrerPolicy="no-referrer"
        style={{
          objectFit: "cover",
          opacity: dimmed ? 0.5 : 1,
          ...(size ? { width: size, height: size } : null),
        }}
      />
    );
  }

  return (
    <span
      className={className}
      data-avatar=""
      style={{
        color: accent,
        opacity: dimmed ? 0.5 : 1,
        ...(size ? { width: size, height: size } : null),
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
