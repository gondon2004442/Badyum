/**
 * Правила для вложений.
 *
 * Здесь нет ни хранилища, ни сети — только решения, от которых зависит
 * безопасность: что считать картинкой, каким именем это отдавать и как
 * подписать ответ, чтобы браузер не выполнил присланный файл как код.
 *
 * Вынесено сюда и покрыто тестами намеренно. Загрузка файлов — единственное
 * место в сервисе, где чужой байт попадает на наш домен, а рядом с этим
 * доменом живёт кука сессии. Ошибка тут стоит не «некрасиво отображается», а
 * «любой участник канала угоняет чужой аккаунт».
 */

/** Больше этого не принимаем. Скриншот весит сотни килобайт, а не десятки мегабайт. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Что показываем прямо в переписке, а что — карточкой со скачиванием.
 *
 * SVG в этом списке нет и не будет. Он не картинка, а документ: внутри
 * `<script>`, и открытый с нашего домена он выполняется с правами нашей
 * страницы, то есть добирается до куки сессии. Отдаём его как файл.
 */
export type AttachmentKind = "image" | "file";

/** Типы, которые мы согласны отдать как inline-картинку. */
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function isInlineImage(mime: string): boolean {
  return INLINE_IMAGE_TYPES.has(mime.toLowerCase());
}

/**
 * Что это за файл — по первым байтам, а не по тому, что сказал клиент.
 *
 * Присланному Content-Type верить нельзя вовсе: назвать `image/png` можно что
 * угодно, включая html со скриптом. Сигнатура врать не умеет — она и есть
 * содержимое.
 *
 * `null` означает «не узнали», и это не ошибка: такой файл просто уедет
 * вложением на скачивание, а не картинкой.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1;

  // PNG: \x89PNG\r\n\x1a\n
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";

  // GIF87a / GIF89a
  if (
    at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 &&
    (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61
  ) {
    return "image/gif";
  }

  // WebP: RIFF....WEBP — проверяем обе метки, иначе сюда попадёт любой RIFF,
  // включая wav и avi.
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Имя файла, которое не сделает ничего лишнего.
 *
 * Убираем разделители путей (иначе `../../` уезжает в ключ хранилища и в
 * заголовок), управляющие символы (ими режут заголовок пополам и дописывают
 * свой) и кавычки. Пустое имя заменяем — файл без имени скачивается как
 * «download» и человек не понимает, что получил.
 */
export function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[/\\]/g, "_")
    // Управляющие символы: перевод строки в заголовке — это его конец,
    // а дальше приславший дописывает любой другой заголовок.
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 120);

  // Имя целиком из точек — это `.` или `..`, то есть каталог, а не файл.
  return /^\.*$/.test(cleaned) ? "файл" : cleaned;
}

/**
 * Заголовок Content-Disposition.
 *
 * Две формы имени подряд — не перестраховка, а требование совместимости:
 * `filename=` понимают все, но только ASCII, а кириллица живёт в
 * `filename*=UTF-8''…` (RFC 5987), которого не знают старые клиенты. Кто
 * знает обе — берёт вторую.
 */
export function contentDisposition(name: string, kind: AttachmentKind): string {
  const safe = safeFileName(name);
  // В ASCII-форме оставляем только то, что заведомо не сломает разбор.
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/[";\\]/g, "_");
  const encoded = extValue(safe);

  /*
    Картинку показываем на месте (inline), всё остальное — только скачиванием.
    Это второй замок после проверки сигнатуры: даже если что-то неопознанное
    просочится, браузер его не отрисует и не выполнит, а положит в загрузки.
  */
  const how = kind === "image" ? "inline" : "attachment";
  return `${how}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Значение для `filename*=` по RFC 5987.
 *
 * `encodeURIComponent` здесь не годится: он оставляет как есть `'`, `!`, `*`,
 * `(` и `)`, а апостроф в этой грамматике — разделитель полей
 * (`charset'language'значение`). Имя с апострофом парсер обрежет по нему и
 * покажет огрызок. Поэтому кодируем всё, кроме явно разрешённых attr-char.
 */
function extValue(name: string): string {
  const allowed = /[A-Za-z0-9!#$&+\-.^_`|~]/;
  let out = "";

  for (const byte of new TextEncoder().encode(name)) {
    const char = String.fromCharCode(byte);
    out += byte < 128 && allowed.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }

  return out;
}

/** Размеры картинки, присланные клиентом. Нужны только чтобы не прыгала вёрстка. */
export function saneDimension(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  // Верхняя граница взята с запасом от любой настоящей фотографии; смысл её в
  // том, чтобы вёрстка не поехала от присланного миллиона.
  if (rounded < 1 || rounded > 20000) return undefined;
  return rounded;
}

/** По-человечески о размере: «2,4 МБ» вместо 2516582. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}
