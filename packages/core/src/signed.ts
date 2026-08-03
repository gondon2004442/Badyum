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

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array | null {
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

/** Что всегда есть в подписанном значении помимо полезной нагрузки. */
interface Expiring {
  exp: number;
}

/**
 * Подписанное значение с сроком жизни.
 *
 * Компактная замена JWT: тело в base64url, точка, подпись HMAC-SHA256. Для
 * задач вида «разреши это в течение N времени» библиотека JWT со всем зоопарком
 * алгоритмов была бы и лишней зависимостью, и лишней поверхностью атаки —
 * начиная с `alg: none`.
 *
 * Секрет передаётся аргументом, а не читается из окружения: так модуль остаётся
 * пригодным и для Worker, и для тестов, и его поведение не зависит от того, что
 * оказалось в process.env.
 *
 * Асинхронный, потому что таков WebCrypto. Обработчик, который его вызывает,
 * обязан помнить: await посреди разбора сообщений от одного сокета открывает
 * гонку порядка, и её надо закрывать явной очередью.
 */
export class SignedValues {
  private readonly secret: string;
  private key: Promise<HmacKey> | null = null;

  constructor(secret: string) {
    this.secret = secret;
  }

  private cryptoKey(): Promise<HmacKey> {
    // Импорт ключа кэшируем: он повторяется на каждую проверку.
    this.key ??= crypto.subtle.importKey(
      "raw",
      encoder.encode(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    return this.key;
  }

  /** Подписать полезную нагрузку на заданный срок. */
  async sign<T extends object>(payload: T, ttlSeconds: number): Promise<string> {
    const body = toBase64Url(
      encoder.encode(
        JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
      ),
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.cryptoKey(),
      encoder.encode(body),
    );
    return `${body}.${toBase64Url(new Uint8Array(signature))}`;
  }

  /**
   * Проверить подпись и срок. Возвращает нагрузку или null — исключений здесь
   * нет намеренно: неверное значение это обычный ход событий, а не поломка.
   */
  async verify<T extends object>(value: string): Promise<(T & Expiring) | null> {
    const dot = value.indexOf(".");
    if (dot <= 0) return null;

    const body = value.slice(0, dot);
    const signature = fromBase64Url(value.slice(dot + 1));
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

    let payload: T & Expiring;
    try {
      payload = JSON.parse(decoder.decode(decoded)) as T & Expiring;
    } catch {
      return null;
    }

    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    return payload;
  }
}
