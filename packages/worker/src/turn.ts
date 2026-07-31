import { z } from "zod";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const CF_ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";

/**
 * Сколько живут креды и когда идём за новыми.
 *
 * Запас большой не от лени: RTCPeerConnection запоминает iceServers при
 * создании и держит их до закрытия, включая ICE restart. Истеки они посреди
 * разговора — relay отвалился бы молча, соединение просто не пересобралось бы
 * при следующей смене сети.
 */
const TTL_SECONDS = 12 * 60 * 60;
const MIN_REMAINING_SECONDS = 6 * 60 * 60;

/** Cloudflare STUN бесплатный и без лимитов; Google — запасной. */
const STUN_URLS = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

const serverSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const responseSchema = z.object({
  iceServers: z.union([serverSchema, z.array(serverSchema)]),
});

/**
 * Порт 53 браузеры блокируют — кандидат на нём не подключится, но ICE будет
 * ждать его таймаута. Такой адрес не «лишний в списке», он замедляет установку
 * соединения. Сам Cloudflare это и советует.
 */
const isUsable = (url: string) => !/:53(\?|$)/.test(url);

export function normalizeCloudflareServers(payload: unknown): IceServer[] {
  const parsed = responseSchema.parse(payload);
  const raw = Array.isArray(parsed.iceServers) ? parsed.iceServers : [parsed.iceServers];

  const servers: IceServer[] = [];
  for (const entry of raw) {
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).filter(isUsable);
    if (urls.length === 0) continue;
    servers.push({
      urls,
      ...(entry.username ? { username: entry.username } : {}),
      ...(entry.credential ? { credential: entry.credential } : {}),
    });
  }
  return servers;
}

/**
 * Managed relay Cloudflare.
 *
 * Один набор кред на всех, а не по набору на участника: креды у них не привязаны
 * к пользователю, так что персональные ничего бы не защитили, зато стоили бы
 * обращения к чужому API на каждый вход в канал.
 *
 * Кэш живёт в памяти изолята. Промах стоит одного запроса, а не ошибки, поэтому
 * держать его в хранилище незачем.
 */
export class CloudflareTurn {
  private cached: IceServer[] = [];
  private expiresAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly keyId: string,
    private readonly apiToken: string,
    private readonly endpoint: string = CF_ENDPOINT,
  ) {}

  private fresh(): boolean {
    return (
      this.cached.length > 0 && this.expiresAt - Date.now() > MIN_REMAINING_SECONDS * 1000
    );
  }

  /** Список для браузера. Адреса не повторяются: дубль — лишний круг сбора кандидатов. */
  async iceServers(): Promise<IceServer[]> {
    if (!this.fresh()) await this.refresh();

    const seen = new Set<string>();
    const result: IceServer[] = [];
    for (const server of [{ urls: STUN_URLS } as IceServer, ...this.cached]) {
      const urls: string[] = [];
      for (const url of Array.isArray(server.urls) ? server.urls : [server.urls]) {
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
      if (urls.length > 0) result.push({ ...server, urls });
    }
    return result;
  }

  /** Параллельные промахи схлопываются в один запрос. */
  private refresh(): Promise<void> {
    this.inflight ??= this.request().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async request(): Promise<void> {
    const url = `${this.endpoint}/${encodeURIComponent(this.keyId)}/credentials/generate-ice-servers`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      });

      if (!response.ok) {
        console.warn(`Cloudflare TURN ответил ${response.status}`);
        return;
      }

      const servers = normalizeCloudflareServers(await response.json());
      if (servers.length === 0) {
        console.warn("Cloudflare TURN не отдал ни одного пригодного адреса");
        return;
      }

      this.cached = servers;
      this.expiresAt = Date.now() + TTL_SECONDS * 1000;
    } catch (err) {
      // Старый кэш не трогаем: если он ещё жив, разговоры продолжаются.
      console.warn(
        `Cloudflare TURN недоступен: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  configured(): boolean {
    return this.fresh();
  }
}

/** Только STUN — когда relay не настроен. Из мобильных сетей за CGNAT не соединит. */
export const stunOnly = (): IceServer[] => [{ urls: STUN_URLS }];
