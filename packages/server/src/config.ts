import { createHmac, randomBytes } from "node:crypto";

const env = process.env;

/**
 * Секрет подписи токенов. В проде задаётся явно; в дев-режиме генерируется на
 * старте — это нормально, потому что перезапуск сервера и так рвёт все сессии.
 */
export const TOKEN_SECRET =
  env.BADYUM_TOKEN_SECRET ?? randomBytes(32).toString("hex");

export const PORT = Number(env.PORT ?? 8787);
export const HOST = env.HOST ?? "0.0.0.0";

/** Откуда пускаем браузер. В деве — Vite. */
export const ALLOWED_ORIGINS = (env.BADYUM_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Сколько живёт токен входа: он нужен только чтобы открыть WebSocket. */
export const TOKEN_TTL_SECONDS = 120;

/**
 * Токен переподключения. Живёт долго намеренно: обрыв связи в метро или
 * переход с Wi-Fi на LTE легко длится минуты, и всё это время человек должен
 * иметь возможность молча вернуться в тот же канал под тем же именем.
 */
export const RESUME_TOKEN_TTL_SECONDS = 60 * 60;

/** Потолок mesh-топологии. Выше — уже нужен SFU, а не N² соединений. */
export const MAX_PARTICIPANTS = Number(env.BADYUM_MAX_PARTICIPANTS ?? 8);

/**
 * TURN. Список, а не один хост, с первого дня: "вне геолокации" на практике
 * означает relay в нескольких регионах, и добавление второго не должно
 * требовать переписывания конфига.
 */
const TURN_HOSTS = (env.BADYUM_TURN_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const TURN_SECRET = env.BADYUM_TURN_SECRET ?? "";
const TURN_TTL_SECONDS = 600;

const STUN_URLS = (
  env.BADYUM_STUN_URLS ?? "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Короткоживущие TURN-креды по HMAC-схеме coturn (`use-auth-secret`):
 * username = "<expiry>:<userId>", password = base64(HMAC-SHA1(username, secret)).
 * Статический логин/пароль в конфиге клиента утекает первым же открытым
 * DevTools и превращает наш relay в чужой прокси.
 */
export function iceServersFor(userId: string): IceServer[] {
  const servers: IceServer[] = [{ urls: STUN_URLS }];

  if (TURN_HOSTS.length === 0 || !TURN_SECRET) return servers;

  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiry}:${userId}`;
  const credential = createHmac("sha1", TURN_SECRET)
    .update(username)
    .digest("base64");

  servers.push({ urls: TURN_HOSTS, username, credential });
  return servers;
}

/** Настроен ли relay. Без него мобильные сети за CGNAT не соединятся. */
export const hasTurn = TURN_HOSTS.length > 0 && TURN_SECRET.length > 0;
