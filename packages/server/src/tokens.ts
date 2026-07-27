import { createHmac, timingSafeEqual } from "node:crypto";
import { TOKEN_SECRET, TOKEN_TTL_SECONDS } from "./config.ts";

export interface JoinClaims {
  userId: string;
  channelId: string;
  displayName: string;
  /** Код инвайта, по которому вошли — чтобы засчитать использование. */
  inviteCode: string | null;
  exp: number;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

/**
 * Компактный подписанный токен вместо полноценного JWT.
 *
 * Он живёт две минуты и делает ровно одно: разрешает открыть WebSocket в
 * конкретный канал под конкретным именем. Для такой задачи библиотека JWT со
 * всем зоопарком алгоритмов — лишняя зависимость и лишняя поверхность атаки.
 */
export function signJoinToken(claims: Omit<JoinClaims, "exp">): string {
  const payload: JoinClaims = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", TOKEN_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyJoinToken(token: string): JoinClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", TOKEN_SECRET).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  let claims: JoinClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JoinClaims;
  } catch {
    return null;
  }

  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
  if (!claims.userId || !claims.channelId || !claims.displayName) return null;

  return claims;
}
