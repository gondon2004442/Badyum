/**
 * Ник — то, что человек про себя пишет. Тег выдаёт сервис.
 *
 * Кириллица допускается намеренно: ник должен быть тем, которым человека
 * действительно зовут, а не транслитерацией. Регистр сохраняется — «Дюма» и
 * «дюма» пишутся по-разному, хотя занимают одно и то же место (сравнение при
 * поиске идёт по нижнему регистру, это забота хранилища).
 */
export function normalizeNick(raw: string): string | null {
  const nick = raw
    .replace(/[\p{C}]/gu, "")
    .trim()
    // Пробелы внутри ника превращаем в подчёркивание: «ду макс#4821» читается
    // как два разных куска, а тег отрывается от имени.
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_.-]/gu, "")
    .slice(0, 24);

  return nick.length >= 2 ? nick : null;
}

/**
 * Ник из имени, пришедшего от поставщика входа.
 *
 * Отдаём запасной вариант, а не null: у человека, вошедшего через Google, имя
 * может оказаться из одних эмодзи или иероглифов, которые мы вычистим. Оставить
 * его без ника нельзя — он только что успешно вошёл.
 */
export function nickFromName(raw: string, fallback = "гость"): string {
  return normalizeNick(raw) ?? fallback;
}

/** Как ник выглядит целиком: «дюма#4821». */
export function fullNick(nick: string, tag: string): string {
  return `${nick}#${tag}`;
}

/**
 * Разбор «дюма#4821» на части. Возвращает null, если это не пара ник-тег —
 * поиск по такой строке должен сказать «не найдено», а не искать мусор.
 */
export function parseFullNick(raw: string): { nick: string; tag: string } | null {
  const hash = raw.lastIndexOf("#");
  if (hash <= 0) return null;

  const nick = normalizeNick(raw.slice(0, hash));
  const tag = raw.slice(hash + 1).trim();
  if (!nick || !/^\d{4}$/.test(tag)) return null;

  return { nick, tag };
}
