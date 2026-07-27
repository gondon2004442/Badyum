import { randomInt, randomUUID } from "node:crypto";

/**
 * Алфавит инвайт-кодов. Из него выброшены символы, которые люди путают при
 * чтении с экрана и на слух: 0/O и 1/l/I. Код диктуют голосом прямо в игре,
 * так что это не теоретический риск.
 *
 * Следствие: ни один из выброшенных символов не может встретиться в настоящем
 * коде, поэтому "исправлять" их при вводе нечего — такой ввод просто неверный.
 */
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const CODE_LENGTH = 6;

export function generateInviteCode(length = CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Приводит введённый код к каноническому виду. Регистр не важен, окружающий
 * мусор (пробелы, вставленный целиком URL) отбрасывается — человек копирует
 * ссылку из чата, а не аккуратные шесть символов.
 *
 * Возвращает null, если после чистки это не валидный код.
 */
export function normalizeInviteCode(raw: string): string | null {
  let candidate = raw.trim().toLowerCase();

  // Вставили ссылку целиком. Сначала отрезаем query и hash — иначе последним
  // сегментом окажется "from=tg", а не код, — и только потом берём путь.
  candidate = candidate.split(/[?#]/)[0] ?? "";
  if (candidate.includes("/")) {
    const parts = candidate.split("/").filter(Boolean);
    candidate = parts[parts.length - 1] ?? "";
  }

  if (candidate.length !== CODE_LENGTH) return null;
  for (const ch of candidate) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return candidate;
}

/**
 * Кодовое слово-комната: "Badyum Катка!" -> "badyum-катка".
 * Кириллица допускается намеренно — слово должно быть тем, которое реально
 * произносят, а не транслитерацией.
 */
export function normalizeSlug(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length < 3 || slug.length > 48) return null;
  return slug;
}

/** Имя гостя: обрезаем до вменяемой длины и глушим управляющие символы. */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw
    .replace(/[\p{C}]/gu, "")
    .trim()
    .slice(0, 32);
  return name.length >= 1 ? name : null;
}

/** Тег в паре к нику: dumax#4821. */
export function generateTag(): string {
  return String(randomInt(10000)).padStart(4, "0");
}

export function newUserId(): string {
  return randomUUID();
}

export function newChannelId(): string {
  return `ch_${randomUUID()}`;
}
