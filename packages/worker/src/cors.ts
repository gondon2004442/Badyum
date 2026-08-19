/**
 * Межсайтовые запросы из десктопного приложения.
 *
 * Приложение показывает страницу из своих файлов, и origin у неё не наш:
 * `tauri://localhost` на macOS и Linux, `http://tauri.localhost` на Windows.
 * Значит каждое обращение к API для движка окна — межсайтовое, и без явного
 * разрешения он режет ответ, не показывая причины.
 *
 * До переезда на Cloudflare это делал старый сервер через BADYUM_ORIGINS.
 * Вместе с ним разрешение и потерялось: приложение перестало доставать до
 * сервера вовсе, а выглядело как «не получилось войти в канал».
 */

/**
 * Origin'ы десктопной обёртки.
 *
 * Схема зависит от платформы, и все три перечислены нарочно: собранное
 * приложение одно и то же, а под какой системой его запустят — неизвестно.
 */
const APP_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

/** Методы, которые ничего не меняют. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Свой ли это origin: наш собственный сайт или наша обёртка. */
export function known(origin: string | null, self: string): boolean {
  if (!origin) return false;
  return origin === self || APP_ORIGINS.has(origin);
}

/**
 * Заголовки разрешения для конкретного origin.
 *
 * Конкретного, а не `*`: со звёздочкой браузер отказывается слать куки, а вся
 * сессия у нас на куке. Отсюда же `Vary: Origin` — ответ зависит от того, кто
 * спросил, и общий кеш не должен отдать чужое разрешение.
 */
export function allowHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/** Ответ на предполётный запрос. `null` — origin чужой, отвечать нечего. */
export function preflight(request: Request, self: string): Response | null {
  if (request.method !== "OPTIONS") return null;

  const origin = request.headers.get("origin");
  if (!known(origin, self)) return new Response(null, { status: 403 });

  return new Response(null, { status: 204, headers: allowHeaders(origin!) });
}

/** Дописать разрешение к готовому ответу. Чужому origin ничего не дописываем. */
export function withCors(response: Response, request: Request, self: string): Response {
  const origin = request.headers.get("origin");
  if (!known(origin, self)) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(allowHeaders(origin!))) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Не подделка ли это запроса с чужого сайта.
 *
 * Проверка появилась вместе с `SameSite=None` у сессионной куки. Пока кука была
 * `Lax`, браузер сам не отправлял её на межсайтовые запросы, и это защищало от
 * CSRF даром. Теперь отправляет — значит чужой сайт мог бы дёрнуть наш API от
 * имени вошедшего человека, и отличить его надо самим.
 *
 * Отличаем по `Origin`: подделать его страница не может, браузер ставит его
 * сам. Читать наши ответы чужой сайт всё равно не сможет — разрешение мы
 * выдаём только своим, — но выполниться запрос успел бы, а этого достаточно,
 * чтобы завести канал или удалить аватарку за человека.
 *
 * Отсутствие заголовка пропускаем: его не ставят curl и наши же тесты, а
 * браузеры на межсайтовых запросах ставят всегда — то есть на защиту это не
 * влияет.
 */
export function forged(request: Request, self: string): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const origin = request.headers.get("origin");
  if (origin === null) return false;

  return !known(origin, self);
}
