import { ChannelStore, type Channel, type ResolveError, type Resolved } from "./channels.ts";
import { RateLimiter } from "./rate.ts";

export type GateError = ResolveError | "auth_required" | "too_many";

/**
 * Кто именно заводит канал.
 *
 * `null` — никто: у пришедшего нет права создавать. Строка — ключ, по которому
 * считается частота; обычно это id аккаунта, но не обязательно (см. `create`).
 */
export type Creator = string | null;

/**
 * Кому можно заводить каналы.
 *
 * Отдельный слой поверх хранилища, потому что путей создания два и правило у
 * них общее: кнопка «Новый канал» и вход по свободному кодовому слову. Закрыть
 * один и оставить второй — то же самое, что не закрывать ничего: цикл в консоли
 * так же плодил бы каналы, только подставляя случайные слова вместо нажатий.
 *
 * Вход в уже существующий канал этот слой не трогает вовсе. Гость по ссылке
 * по-прежнему заходит, введя одно имя, — на этом держится весь продукт.
 */
export class ChannelGate {
  private readonly store: ChannelStore;
  private readonly limiter: RateLimiter;

  constructor(
    store: ChannelStore,
    limit: number,
    windowMs: number,
    now: () => number = Date.now,
  ) {
    this.store = store;
    this.limiter = new RateLimiter(limit, windowMs, now);
  }

  /**
   * Явное создание канала — то, что за кнопкой «Новый канал».
   *
   * `caller` не обязан быть аккаунтом: решение «кто имеет право» принимается
   * снаружи, здесь только считается частота. Копия сервиса без настроенного
   * входа передаёт сюда адрес — иначе завести канал в ней было бы нечем.
   */
  create(
    caller: Creator,
    opts: { name: string; slug?: string | null; ephemeral?: boolean },
  ): { ok: true; channel: Channel } | { ok: false; error: "auth_required" | "too_many" } {
    if (caller === null) return { ok: false, error: "auth_required" };
    if (!this.limiter.allow(caller)) return { ok: false, error: "too_many" };
    return { ok: true, channel: this.store.createChannel(opts) };
  }

  /**
   * Вход по чему угодно: ссылке, кодовому слову, id канала.
   *
   * Существующий канал отдаётся всем и без вопросов. Право спрашивается ровно в
   * одном случае — когда слово свободно и канал пришлось бы завести.
   *
   * Метод синхронный, и это важно: между проверкой «слова ещё нет» и созданием
   * канала нет ни одной точки, где обработчик мог бы уступить управление. Двое,
   * назвавшие одно слово одновременно, окажутся в одном канале, а не в двух
   * разных с одинаковым названием.
   */
  resolve(
    caller: Creator,
    input: { code?: string; slug?: string; channelId?: string },
  ): { ok: true; value: Resolved } | { ok: false; error: GateError } {
    const found = this.store.resolve(input, { createMissingSlug: false });
    if (found.ok) return found;

    // Создание касается только кодовых слов. Ссылка и id указывают на канал,
    // который либо есть, либо его нет, и выдумывать тут нечего.
    if (input.slug === undefined || found.error !== "not_found") return found;

    if (caller === null) return { ok: false, error: "auth_required" };
    if (!this.limiter.allow(caller)) return { ok: false, error: "too_many" };

    return this.store.resolve(input, { createMissingSlug: true });
  }

  /** Сколько каналов осталось создать прямо сейчас. Для диагностики. */
  remaining(caller: string): number {
    return this.limiter.remaining(caller);
  }
}
