/**
 * Аватар-градиент, детерминированно выведенный из userId.
 *
 * Пока нет загрузки картинок, участник всё равно должен быть узнаваем с одного
 * взгляда — одинаковые серые кружки в канале на шесть человек бесполезны.
 * Один и тот же человек всегда одного цвета.
 */

const PALETTE: [string, string][] = [
  ["#c3f53c", "#3de8b0"],
  ["#6b8cfa", "#a65cf2"],
  ["#ffb020", "#ff4d5e"],
  ["#3de8b0", "#6b8cfa"],
  ["#ff7ac6", "#ffb020"],
  ["#4fd1ff", "#3de8b0"],
];

function hash(input: string): number {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(value);
}

export function gradientFor(userId: string): string {
  const pair = PALETTE[hash(userId) % PALETTE.length] ?? PALETTE[0]!;
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

interface AvatarProps {
  userId: string;
  size?: number;
  dimmed?: boolean;
  className?: string;
}

export function Avatar({ userId, size, dimmed, className }: AvatarProps) {
  return (
    <div
      className={className}
      style={{
        background: gradientFor(userId),
        opacity: dimmed ? 0.55 : 1,
        ...(size ? { width: size, height: size, borderRadius: "50%" } : null),
      }}
    />
  );
}
