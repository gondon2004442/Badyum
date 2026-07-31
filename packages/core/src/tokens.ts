export interface JoinClaims {
  userId: string;
  channelId: string;
  displayName: string;
  /** Код инвайта, по которому вошли — чтобы засчитать использование. */
  inviteCode: string | null;
  /** Устойчивая личность, если клиент её прислал. Прав не даёт, см. протокол. */
  identityId?: string | null;
  exp: number;
  /** Токен переподключения: длинный срок жизни, инвайт уже не засчитывается. */
  resume?: boolean;
}

/** Сколько живёт токен входа: он нужен только чтобы открыть WebSocket. */
export const TOKEN_TTL_SECONDS = 120;

/**
 * Токен переподключения. Живёт долго намеренно: обрыв связи в метро или переход
 * с Wi-Fi на LTE легко длится минуты, и всё это время человек должен иметь
 * возможность молча вернуться в тот же канал под тем же именем.
 */
export const RESUME_TOKEN_TTL_SECONDS = 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Тип ключа выводим из самой importKey, а не пишем `CryptoKey`.
 *
 * Имя `CryptoKey` живёт в lib.dom, а ядро собирается без DOM намеренно — иначе
 * в него незаметно просочился бы браузерный API. Node и workerd описывают этот
 * тип по-разному, и вывод из функции подходит обоим.
 */
type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  // atob не прощает ни алфавит base64url, ни отсутствие выравнивания.
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Подписыватель токенов.
 *
 * Компактный подписанный токен вместо полноценного JWT: он живёт минуты и делает
 * ровно одно — разрешает открыть WebSocket в конкретный канал под конкретным
 * именем. Для такой задачи библиотека JWT со всем зоопарком алгоритмов была бы
 * и лишней зависимостью, и лишней поверхностью атаки.
 *
 * Секрет передаётся аргументом, а не читается из окружения: так модуль остаётся
 * пригодным и для Worker, и для тестов, и его поведение не зависит от того, что
 * оказалось в process.env.
 *
 * Асинхронный, потому что таков WebCrypto. Обработчик, который его вызывает,
 * обязан помнить: await посреди разбора сообщений от одного сокета открывает
 * гонку порядка, и её надо закрывать явной очередью.
 */
export class TokenSigner {
  private readonly secret: string;
  private key: Promise<HmacKey> | null = null;

  constructor(secret: string) {
    this.secret = secret;
  }

  private cryptoKey(): Promise<HmacKey> {
    // Импорт ключа кэшируем: он повторяется на каждый вход в канал.
    this.key ??= crypto.subtle.importKey(
      "raw",
      encoder.encode(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    return this.key;
  }

  private async sign(body: string): Promise<string> {
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.cryptoKey(),
      encoder.encode(body),
    );
    return toBase64Url(new Uint8Array(signature));
  }

  private async pack(payload: JoinClaims): Promise<string> {
    const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
    return `${body}.${await this.sign(body)}`;
  }

  signJoinToken(claims: Omit<JoinClaims, "exp">): Promise<string> {
    return this.pack({
      ...claims,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    });
  }

  /**
   * Токен возврата в тот же канал под тем же userId.
   *
   * inviteCode намеренно сбрасывается: переподключение не должно повторно
   * съедать использование одноразовой ссылки.
   */
  signResumeToken(claims: Omit<JoinClaims, "exp" | "resume">): Promise<string> {
    return this.pack({
      ...claims,
      inviteCode: null,
      resume: true,
      exp: Math.floor(Date.now() / 1000) + RESUME_TOKEN_TTL_SECONDS,
    });
  }

  async verify(token: string): Promise<JoinClaims | null> {
    const dot = token.indexOf(".");
    if (dot <= 0) return null;

    const body = token.slice(0, dot);
    const signature = fromBase64Url(token.slice(dot + 1));
    if (!signature) return null;

    // crypto.subtle.verify сравнивает за постоянное время — своё сравнение
    // байтов здесь было бы и лишним, и хуже.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await this.cryptoKey(),
      signature,
      encoder.encode(body),
    );
    if (!valid) return null;

    const decoded = fromBase64Url(body);
    if (!decoded) return null;

    let claims: JoinClaims;
    try {
      claims = JSON.parse(decoder.decode(decoded)) as JoinClaims;
    } catch {
      return null;
    }

    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
    if (!claims.userId || !claims.channelId || !claims.displayName) return null;

    return claims;
  }
}
