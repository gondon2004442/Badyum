/**
 * Аватар — плоский квадрат с моноширинными инициалами и одним акцентным цветом.
 *
 * Пока нет загрузки картинок, участник всё равно должен опознаваться с одного
 * взгляда: одинаковые серые кружки в канале на шесть человек бесполезны. Цвет
 * выводится из userId, поэтому один и тот же человек всегда одного цвета.
 */

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
  size?: number;
  dimmed?: boolean;
  className?: string;
}

export function Avatar({ userId, name, size, dimmed, className }: AvatarProps) {
  const accent = accentFor(userId);

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
