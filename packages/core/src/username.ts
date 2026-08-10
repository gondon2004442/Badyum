/**
 * Юз — то, по чему человека находят и добавляют в контакты.
 *
 * Раньше уникальность обеспечивал случайный тег: «дюма» мог быть не один, их
 * разводило `#4821`. Теперь уникален сам юз, и тег исчез — он существовал
 * только чтобы разводить одинаковые ники, а лишние четыре цифры надо было
 * диктовать вслух и запоминать ни за чем.
 *
 * Только латиница, цифры, точка и подчёркивание. Причины две. Первая:
 * продиктовать юз должен мочь и человек с другой раскладкой — у нас уже есть
 * собеседник из Португалии. Вторая важнее: кириллические «а», «е», «о», «р»,
 * «с» неотличимы на вид от латинских, и «дumax» рядом с «dumax» — это не
 * опечатка, а способ выдать себя за другого.
 */

/** Короче — не юз, а инициалы; длиннее — не помещается в строку контакта. */
const MIN_LENGTH = 3;
const MAX_LENGTH = 20;

/**
 * Занятые сервисом слова.
 *
 * Не безопасность, а гигиена: письмо от «badyum» или «support» человек читает
 * как письмо от сервиса, и одного этого хватает, чтобы у него что-нибудь
 * выманили.
 */
const RESERVED = new Set([
  "badyum",
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "system",
  "moderator",
  "everyone",
  "here",
]);

export type UsernameProblem =
  | "too_short"
  | "too_long"
  | "bad_chars"
  | "bad_edges"
  | "double_separator"
  | "reserved";

/**
 * Приводит введённое к каноническому виду или объясняет, что не так.
 *
 * Возвращает именно причину, а не просто null: «юз не подходит» человек читает
 * как «сервис сломался», а «можно только латиницу, цифры, точку и
 * подчёркивание» — как понятное правило.
 */
export function normalizeUsername(
  raw: string,
): { ok: true; username: string } | { ok: false; problem: UsernameProblem } {
  // Пробелы по краям — почти всегда след копирования, а не намерение.
  const value = raw.trim();

  if (value.length < MIN_LENGTH) return { ok: false, problem: "too_short" };
  if (value.length > MAX_LENGTH) return { ok: false, problem: "too_long" };
  if (!/^[A-Za-z0-9._]+$/.test(value)) return { ok: false, problem: "bad_chars" };

  // Разделитель по краям читается как обрезок: «.dumax» и «dumax_» выглядят
  // так, будто строку скопировали не целиком.
  if (/^[._]|[._]$/.test(value)) return { ok: false, problem: "bad_edges" };

  // Два разделителя подряд — способ завести почти неотличимый юз: «du..max»
  // рядом с «du.max» глазом не различается.
  if (/[._]{2}/.test(value)) return { ok: false, problem: "double_separator" };

  if (RESERVED.has(value.toLowerCase())) return { ok: false, problem: "reserved" };

  return { ok: true, username: value };
}

/**
 * Ключ, по которому юз считается занятым.
 *
 * Регистр человек выбирает сам — «Dumax» пишется так, как он написал. Но занят
 * при этом и «dumax»: два юза, различающиеся только регистром, никто на слух
 * не различит, и это была бы та же подделка, только другими средствами.
 */
export const usernameKey = (username: string): string => username.toLowerCase();

/**
 * Юз из имени, пришедшего от поставщика входа — как первое предложение.
 *
 * Возвращает null, если предложить нечего: имя из кириллицы или иероглифов
 * даёт пустоту, и подставлять человеку мусор хуже, чем оставить поле пустым.
 */
export function suggestUsername(displayName: string): string | null {
  const value = displayName
    .normalize("NFKD")
    // Диакритика: «Renée» → «Renee», а не «Rene» с дырой посередине.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._]/g, "_")
    .replace(/[._]{2,}/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, MAX_LENGTH);

  const result = normalizeUsername(value);
  return result.ok ? result.username : null;
}
