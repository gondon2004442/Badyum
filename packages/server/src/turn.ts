import { createHmac } from "node:crypto";
import { z } from "zod";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const env = process.env;

/**
 * STUN. Cloudflare отдаёт свой бесплатно и без лимитов, поэтому он первый;
 * Google остаётся запасным, чтобы падение одного не убивало определение
 * внешнего адреса целиком.
 */
const STUN_URLS = (
  env.BADYUM_STUN_URLS ??
  "stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Свой coturn. Список, а не один хост, с первого дня: "вне геолокации" на
 * практике означает relay в нескольких регионах, и добавление второго не
 * должно требовать переписывания конфига.
 */
const COTURN_HOSTS = (env.BADYUM_TURN_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const COTURN_SECRET = env.BADYUM_TURN_SECRET ?? "";
const COTURN_TTL_SECONDS = 600;

const CF_KEY_ID = env.BADYUM_CF_TURN_KEY_ID ?? "";
const CF_API_TOKEN = env.BADYUM_CF_TURN_API_TOKEN ?? "";

const CF_ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";

/**
 * Сколько живут креды Cloudflare и когда мы идём за новыми.
 *
 * Запас огромный не от лени: RTCPeerConnection запоминает iceServers при
 * создании и держит их до самого закрытия, включая ICE restart. Если креды
 * истекут посреди разговора, relay отвалится молча — соединение просто не
 * пересоберётся при следующей смене сети. Поэтому наружу отдаём только то, у
 * чего осталось больше MIN_REMAINING: любой начавшийся сейчас разговор
 * переживёт свои креды.
 */
const CF_TTL_SECONDS = 12 * 60 * 60;
const CF_MIN_REMAINING_SECONDS = 6 * 60 * 60;

const cfServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

/** У Cloudflare в разное время был и объект, и массив. Принимаем оба. */
const cfResponseSchema = z.object({
  iceServers: z.union([cfServerSchema, z.array(cfServerSchema)]),
});

/**
 * Порт 53 браузеры блокируют — кандидат на нём не подключится, но ICE будет
 * ждать его таймаута. Такой адрес не «лишний в списке», он замедляет
 * установку соединения, поэтому выбрасываем.
 */
function isUsableUrl(url: string): boolean {
  return !/:53(\?|$)/.test(url);
}

/** Ответ Cloudflare → наш формат. Выделено отдельно, потому что тестируется. */
export function normalizeCloudflareServers(payload: unknown): IceServer[] {
  const parsed = cfResponseSchema.parse(payload);
  const raw = Array.isArray(parsed.iceServers)
    ? parsed.iceServers
    : [parsed.iceServers];

  const servers: IceServer[] = [];
  for (const entry of raw) {
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).filter(
      isUsableUrl,
    );
    if (urls.length === 0) continue;
    servers.push({
      urls,
      ...(entry.username ? { username: entry.username } : {}),
      ...(entry.credential ? { credential: entry.credential } : {}),
    });
  }
  return servers;
}

interface CloudflareTurnOptions {
  keyId: string;
  apiToken: string;
  /** Подменяется в тестах, чтобы проверить связку настоящим fetch. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlSeconds?: number;
  minRemainingSeconds?: number;
  onError?: (message: string) => void;
}

/**
 * Короткоживущие креды к managed relay Cloudflare.
 *
 * Держим один набор на всех, а не по набору на участника. Креды у них не
 * привязаны к пользователю, так что персональные ничего бы не защитили — зато
 * стоили бы обращения к чужому API на каждый вход в канал, то есть добавили бы
 * и задержку, и ещё одну причину, по которой вход мог бы не сработать.
 */
export class CloudflareTurn {
  private readonly keyId: string;
  private readonly apiToken: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly ttlSeconds: number;
  private readonly minRemainingSeconds: number;
  private readonly onError: (message: string) => void;

  private cached: IceServer[] = [];
  private expiresAt = 0;
  private inflight: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CloudflareTurnOptions) {
    this.keyId = options.keyId;
    this.apiToken = options.apiToken;
    this.endpoint = options.endpoint ?? CF_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlSeconds = options.ttlSeconds ?? CF_TTL_SECONDS;
    // Порог не может превышать половину срока жизни: иначе свежие креды сразу
    // считались бы негодными, `servers()` всегда возвращал бы пустоту, и relay
    // молча не работал бы — при полностью верных ключах.
    this.minRemainingSeconds = Math.min(
      options.minRemainingSeconds ?? CF_MIN_REMAINING_SECONDS,
      this.ttlSeconds / 2,
    );
    this.onError = options.onError ?? (() => {});
  }

  /** Есть ли что отдать прямо сейчас, с достаточным запасом жизни. */
  isFresh(): boolean {
    if (this.cached.length === 0) return false;
    return this.expiresAt - this.now() > this.minRemainingSeconds * 1000;
  }

  /**
   * Кэш для выдачи наружу. Синхронный намеренно: вход в канал не должен
   * ждать чужой API. Просроченное не отдаём — молчаливо мёртвый relay хуже,
   * чем явное отсутствие relay, которое видно в /api/health.
   */
  servers(): IceServer[] {
    return this.isFresh() ? this.cached : [];
  }

  /**
   * Обновление. Параллельные вызовы схлопываются в один запрос: обновление
   * дёргают и таймер, и старт, и промах кэша.
   */
  refresh(): Promise<boolean> {
    this.inflight ??= this.request().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async request(): Promise<boolean> {
    const url = `${this.endpoint}/${encodeURIComponent(this.keyId)}/credentials/generate-ice-servers`;
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl: this.ttlSeconds }),
      });

      if (!response.ok) {
        this.onError(`Cloudflare TURN ответил ${response.status}`);
        return false;
      }

      const servers = normalizeCloudflareServers(await response.json());
      if (servers.length === 0) {
        this.onError("Cloudflare TURN не отдал ни одного пригодного адреса");
        return false;
      }

      this.cached = servers;
      this.expiresAt = this.now() + this.ttlSeconds * 1000;
      return true;
    } catch (err) {
      // Старый кэш не трогаем: если он ещё жив, разговоры продолжаются, а мы
      // повторим попытку на следующем тике.
      this.onError(
        `Cloudflare TURN недоступен: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** Периодическая проверка. Интервал мелкий, работа делается только по нужде. */
  start(intervalMs = 5 * 60 * 1000): void {
    this.stop();
    this.timer = setInterval(() => {
      if (!this.isFresh()) void this.refresh();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const cloudflareTurn =
  CF_KEY_ID && CF_API_TOKEN
    ? new CloudflareTurn({
        keyId: CF_KEY_ID,
        apiToken: CF_API_TOKEN,
        onError: (message) => console.warn(message),
      })
    : null;

/**
 * HMAC-схема coturn (`use-auth-secret`):
 * username = "<expiry>:<userId>", password = base64(HMAC-SHA1(username, secret)).
 * Статический логин/пароль в конфиге клиента утекает первым же открытым
 * DevTools и превращает наш relay в чужой прокси.
 */
function coturnServers(userId: string): IceServer[] {
  if (COTURN_HOSTS.length === 0 || !COTURN_SECRET) return [];

  const expiry = Math.floor(Date.now() / 1000) + COTURN_TTL_SECONDS;
  const username = `${expiry}:${userId}`;
  const credential = createHmac("sha1", COTURN_SECRET)
    .update(username)
    .digest("base64");

  return [{ urls: COTURN_HOSTS, username, credential }];
}

/**
 * Что отдаём браузеру.
 *
 * Оба relay складываются в один список, если настроены оба: WebRTC перебирает
 * кандидатов сам, и авария у одного из relay тогда просто не заметна. Именно
 * это и означает «вне зависимости от геолокации» на практике.
 */
export function iceServersFor(userId: string): IceServer[] {
  return [
    { urls: STUN_URLS },
    ...(cloudflareTurn?.servers() ?? []),
    ...coturnServers(userId),
  ];
}

/**
 * Первый набор кред до начала приёма трафика: иначе самый первый вошедший
 * получил бы список без relay и не догадался бы, почему звонок не собрался.
 */
export async function primeTurn(): Promise<void> {
  if (!cloudflareTurn) return;
  await cloudflareTurn.refresh();
  cloudflareTurn.start();
}

/** Настроен ли хоть какой-то relay. Без него мобильные сети за CGNAT не соединятся. */
export function turnStatus(): {
  configured: boolean;
  cloudflare: "off" | "ready" | "failing";
  coturn: boolean;
} {
  const coturn = COTURN_HOSTS.length > 0 && COTURN_SECRET.length > 0;
  const cloudflare = !cloudflareTurn
    ? ("off" as const)
    : cloudflareTurn.isFresh()
      ? ("ready" as const)
      : ("failing" as const);
  return { configured: coturn || cloudflare === "ready", cloudflare, coturn };
}
