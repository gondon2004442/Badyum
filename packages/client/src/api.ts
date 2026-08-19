import { myIdentityId } from "./storage.ts";

export interface JoinResponse {
  token: string;
  channelId: string;
  channelName: string;
}

export interface PreviewResponse {
  exists: boolean;
  channelId?: string;
  channelName: string;
  participants: { userId: string; displayName: string }[];
}

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
}

const MESSAGES: Record<string, string> = {
  not_found: "Такого канала нет — возможно, ссылка устарела",
  invite_expired: "Ссылка больше не действует",
  invite_exhausted: "По этой ссылке уже вошли все, кого звали",
  channel_full: "В канале нет свободных мест",
  bad_input: "Не разобрал ссылку или код",
  bad_display_name: "Такое имя не подойдёт",
  auth_required: "Создавать каналы могут только вошедшие — войди через Google",
  too_many: "Слишком много новых каналов подряд. Попробуй через час",
};

/**
 * Адрес сервера.
 *
 * В браузере остаётся пустым — запросы идут относительными путями на тот же
 * хост, откуда пришла страница. В десктопной обёртке страница загружается из
 * локальных файлов (`tauri://localhost`), относительный путь там ведёт в
 * никуда, поэтому адрес задаётся при сборке через VITE_BADYUM_SERVER.
 */
const SERVER_ORIGIN = (import.meta.env.VITE_BADYUM_SERVER ?? "").replace(/\/+$/, "");

/** Абсолютный адрес для ссылок-приглашений: их отправляют наружу. */
export function publicOrigin(): string {
  return SERVER_ORIGIN || location.origin;
}

/**
 * Куда обращаться за API. Пустая строка означает «относительный путь».
 *
 * Отличается от publicOrigin: там нужен адрес, который можно кому-то
 * отправить, а здесь — тот, по которому ходит эта вкладка. Подставлять
 * `location.origin` нельзя, в десктопной обёртке это `tauri://localhost`.
 */
export function apiOrigin(): string {
  return SERVER_ORIGIN;
}

/**
 * Адрес картинки, пришедшей с сервера.
 *
 * Аватарка бывает двух видов, и различать их обязательно. Свою загруженную
 * сервер хранит относительным путём — `/api/avatar/<id>`; в браузере он сам
 * разворачивается в адрес сайта, а в десктопной обёртке страница лежит в
 * файлах приложения, и тот же путь ведёт в `tauri://localhost/api/avatar/…`,
 * где нет ничего. Гугловская же приходит абсолютным адресом на чужой хост, и
 * дописать к ней наш сервер значило бы сломать ровно то, что работало.
 *
 * Поэтому дополняем только относительные пути. В браузере `apiOrigin()` пуст,
 * и путь остаётся прежним — поведение вкладки не меняется вовсе.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith("/")) return path;
  return `${apiOrigin()}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
    ...init,
    // Куку сессии надо приложить: по ней сервер решает, можно ли завести канал.
    // Для страницы с того же адреса это и так по умолчанию, но в десктопной
    // обёртке страница грузится из локальных файлов, и там уже нет.
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const code = body.error ?? "unknown";
    throw new ApiError(code, MESSAGES[code] ?? "Что-то пошло не так");
  }
  return (await response.json()) as T;
}

/** Что за канал за ссылкой — показываем до того, как просить имя. */
export function previewChannel(input: { code?: string; slug?: string }): Promise<PreviewResponse> {
  const params = new URLSearchParams();
  if (input.code) params.set("code", input.code);
  if (input.slug) params.set("slug", input.slug);
  return request<PreviewResponse>(`/api/preview?${params}`);
}

export function requestJoin(input: {
  displayName: string;
  code?: string;
  slug?: string;
  channelId?: string;
}): Promise<JoinResponse> {
  return request<JoinResponse>("/api/join", {
    method: "POST",
    // Личность прикладываем всегда: по ней собеседники смогут узнать нас при
    // следующей встрече. Прав она не даёт, см. протокол.
    body: JSON.stringify({ ...input, identityId: myIdentityId() }),
  });
}

export function createChannel(name: string): Promise<{
  channelId: string;
  name: string;
  inviteCode: string;
}> {
  return request("/api/channels", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function fetchInviteCode(channelId: string): Promise<{ code: string }> {
  return request<{ code: string }>(`/api/channels/${channelId}/invite`);
}

export function wsUrl(): string {
  if (SERVER_ORIGIN) {
    return `${SERVER_ORIGIN.replace(/^http/, "ws")}/ws`;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}
