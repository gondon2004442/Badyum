import { GoogleIcon } from "./Icons.tsx";
import "./GoogleButton.css";

interface GoogleButtonProps {
  onClick: () => void;
  disabled?: boolean;
  /** Подпись. Меняется на «Жду Google…», пока идёт вход. */
  label: string;
  className?: string;
}

/**
 * Кнопка входа через Google — одна на всё приложение.
 *
 * Одна нарочно: её вид не наш и меняться не может, а разложенная по экранам
 * копиями она разъедется на первой же правке. Канон Google Identity, тёмный
 * вариант — цвета, размеры и логотип лежат в GoogleButton.css вместе с
 * объяснением, почему их нельзя трогать.
 */
export function GoogleButton({ onClick, disabled, label, className }: GoogleButtonProps) {
  return (
    <button
      className={`gbtn${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      <GoogleIcon size={18} className="gbtn__logo" />
      {label}
    </button>
  );
}
