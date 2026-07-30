import { randomBytes } from "node:crypto";

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

// Relay живёт в ./turn.ts — там и managed-вариант Cloudflare, и свой coturn.
