import type { ChannelRoom } from "./ChannelRoom.ts";
import type { Presence } from "./Presence.ts";
import type { Registry } from "./Registry.ts";

export interface Env {
  /** Каталог каналов и инвайтов. Экземпляр один на весь сервис. */
  REGISTRY: DurableObjectNamespace<Registry>;
  /** Комнаты: по объекту на канал. */
  ROOMS: DurableObjectNamespace<ChannelRoom>;
  /**
   * Кто в сети и кто кому звонит. Экземпляр один: чтобы узнать, в сети ли
   * друг, надо смотреть в одно место.
   */
  PRESENCE: DurableObjectNamespace<Presence>;
  /** Статика собранного клиента. */
  ASSETS: Fetcher;
  /**
   * База пользователей.
   *
   * D1, а не хранилище Durable Object: нужны запросы поперёк записей — найти по
   * нику, вытащить друзей, посмотреть кто онлайн. DO знает только про себя.
   */
  DB: D1Database;
  /**
   * Вложения в переписке.
   *
   * Может отсутствовать: до создания бакета сервис обязан работать без
   * вложений, а не падать. Тогда загрузка честно отвечает «не настроено».
   */
  FILES?: R2Bucket;

  /** Подпись токенов входа. Секрет, задаётся через `wrangler secret put`. */
  BADYUM_TOKEN_SECRET: string;
  /** Managed relay Cloudflare. Без него из мобильных сетей не соединиться. */
  BADYUM_CF_TURN_KEY_ID?: string;
  BADYUM_CF_TURN_API_TOKEN?: string;
  /** Потолок mesh-топологии. Выше — нужен SFU, а не N² соединений. */
  BADYUM_MAX_PARTICIPANTS?: string;
  /**
   * Вход через Google. Без них сервис работает — просто без аккаунтов: гостевой
   * вход по ссылке от них не зависит и не должен.
   */
  BADYUM_GOOGLE_CLIENT_ID?: string;
  BADYUM_GOOGLE_CLIENT_SECRET?: string;
}
