import type { ChannelRoom } from "./ChannelRoom.ts";
import type { Registry } from "./Registry.ts";

export interface Env {
  /** Каталог каналов и инвайтов. Экземпляр один на весь сервис. */
  REGISTRY: DurableObjectNamespace<Registry>;
  /** Комнаты: по объекту на канал. */
  ROOMS: DurableObjectNamespace<ChannelRoom>;
  /** Статика собранного клиента. */
  ASSETS: Fetcher;

  /** Подпись токенов входа. Секрет, задаётся через `wrangler secret put`. */
  BADYUM_TOKEN_SECRET: string;
  /** Managed relay Cloudflare. Без него из мобильных сетей не соединиться. */
  BADYUM_CF_TURN_KEY_ID?: string;
  BADYUM_CF_TURN_API_TOKEN?: string;
  /** Потолок mesh-топологии. Выше — нужен SFU, а не N² соединений. */
  BADYUM_MAX_PARTICIPANTS?: string;
}
