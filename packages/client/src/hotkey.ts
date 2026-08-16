/**
 * Нажатие клавиш → сочетание, понятное обёртке.
 *
 * Имена совпадают: `KeyboardEvent.code` даёт `F9`, `KeyB`, `Backquote`, и ровно
 * эти же имена разбирает регистратор системных клавиш. Поэтому таблицы
 * перевода нет — она была бы лишним местом, где две стороны расходятся.
 */

/** Что нужно от события. Не сам KeyboardEvent — так функцию видно насквозь. */
export interface KeyPress {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Сами по себе модификаторы сочетанием не являются. */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** Функциональные клавиши: F1…F24. */
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

export type HotkeyProblem = "modifier-only" | "needs-modifier";

export interface HotkeyResult {
  combo: string | null;
  problem: HotkeyProblem | null;
}

/**
 * Собрать сочетание из нажатия.
 *
 * Одиночная клавиша разрешена только функциональная, и это не придирка.
 * Регистрация системная: заняв под рацию просто `A`, человек лишится буквы «A»
 * во всех программах сразу — в игре, в браузере, в переписке. Понять, что
 * виноват Badyum, при этом почти невозможно. Поэтому всему, кроме F1—F24,
 * требуется модификатор.
 */
export function comboFrom(press: KeyPress): HotkeyResult {
  if (MODIFIER_CODES.has(press.code)) {
    return { combo: null, problem: "modifier-only" };
  }

  const parts: string[] = [];
  if (press.ctrlKey) parts.push("Ctrl");
  if (press.shiftKey) parts.push("Shift");
  if (press.altKey) parts.push("Alt");
  if (press.metaKey) parts.push("Super");

  if (parts.length === 0 && !FUNCTION_KEY.test(press.code)) {
    return { combo: null, problem: "needs-modifier" };
  }

  parts.push(press.code);
  return { combo: parts.join("+"), problem: null };
}

/** Почему нажатие не подошло — словами, которые можно показать человеку. */
export function describeHotkeyProblem(problem: HotkeyProblem): string {
  return problem === "modifier-only"
    ? "Нажми клавишу вместе с Ctrl, Shift или Alt"
    : "Обычную клавишу можно занять только вместе с Ctrl, Shift или Alt — иначе она перестанет работать во всех программах";
}

/**
 * Как сочетание выглядит на экране.
 *
 * `KeyB` и `Digit1` — имена из спецификации, а на кнопке клавиатуры написано
 * не это. Показывать их значит заставлять человека переводить.
 */
export function prettyCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => part.replace(/^Key/, "").replace(/^Digit/, ""))
    .join(" + ");
}
