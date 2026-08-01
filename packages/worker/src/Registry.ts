import { DurableObject } from "cloudflare:workers";
import {
  ChannelStore,
  RateLimiter,
  type Channel,
  type ChannelSink,
  type Invite,
} from "@badyum/core";

const CHANNEL_PREFIX = "ch:";
const INVITE_PREFIX = "inv:";

/**
 * Сколько каналов можно создать с одного адреса за час.
 *
 * Живой человек нажимает «Новый канал» несколько раз за вечер, так что двадцать
 * — это с запасом. Ограничение нужно не против него, а против цикла в консоли:
 * ручка публичная, а каждый канал занимает место в хранилище каталога навсегда.
 */
const CHANNELS_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Каталог каналов и инвайтов, переживающий перезапуск.
 *
 * Экземпляр один на весь сервис. Это сделано ради корректности, а не из
 * простоты: код инвайта и кодовое слово обязаны быть уникальными глобально, и
 * при нескольких писателях двое по одной ссылке могли бы оказаться в разных
 * каналах. Durable Object — единственный писатель по определению, поэтому
 * проверка «код уже занят» здесь честная, а не гонка.
 *
 * Нагрузка на него мизерная: обращения происходят только при создании канала и
 * при входе по ссылке, но не в разговоре — тот идёт мимо, через ChannelRoom.
 */
export class Registry extends DurableObject {
  private readonly store: ChannelStore;
  /**
   * Счётчик держится в памяти и не переживает засыпание объекта. Это осознанно:
   * хранить его — значит писать в хранилище на каждое нажатие кнопки, а цена
   * промаха здесь всего лишь ещё двадцать каналов у настойчивого скрипта.
   */
  private readonly creations = new RateLimiter(CHANNELS_PER_HOUR, HOUR_MS);

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);

    const sink: ChannelSink = {
      // Без await намеренно: DO — единственный писатель, он сам сохраняет
      // порядок записей, а output gate не отпустит ответ клиенту, пока запись
      // не закреплена. Ждать здесь означало бы сделать async весь путь входа.
      saveChannel: (channel) => void ctx.storage.put(CHANNEL_PREFIX + channel.id, channel),
      removeChannel: (id) => void ctx.storage.delete(CHANNEL_PREFIX + id),
      saveInvite: (invite) => void ctx.storage.put(INVITE_PREFIX + invite.code, invite),
      removeInvite: (code) => void ctx.storage.delete(INVITE_PREFIX + code),
    };
    this.store = new ChannelStore(sink);

    /**
     * Загрузка до первого запроса.
     *
     * blockConcurrencyWhile — то, на чём держится весь синхронный sink: пока
     * состояние не поднято, ни один вызов не выполнится. Без этого первый же
     * запрос после пробуждения увидел бы пустой каталог и сказал бы человеку,
     * что канала больше нет.
     */
    ctx.blockConcurrencyWhile(async () => {
      const channels = await ctx.storage.list<Channel>({ prefix: CHANNEL_PREFIX });
      const invites = await ctx.storage.list<Invite>({ prefix: INVITE_PREFIX });
      this.store.hydrate({
        channels: [...channels.values()],
        invites: [...invites.values()],
      });
    });
  }

  // Дальше — ровно тот же интерфейс, что у ChannelStore. Обёртки существуют
  // потому, что через RPC вызываются только объявленные методы, а не класс
  // целиком.

  createChannel(opts: { name: string; slug?: string | null; ephemeral?: boolean }): Channel {
    return this.store.createChannel(opts);
  }

  /**
   * Создание канала по запросу извне — с ограничением частоты.
   *
   * Отдельный метод, а не флаг у createChannel: канал по свободному кодовому
   * слову создаётся внутри resolve, и туда лимит по адресу не относится — там
   * человек не «плодит каналы», а входит в тот, о котором договорились.
   */
  createChannelFor(
    caller: string,
    opts: { name: string; slug?: string | null },
  ): { ok: true; channel: Channel } | { ok: false; error: "too_many" } {
    if (!this.creations.allow(caller)) return { ok: false, error: "too_many" };
    return { ok: true, channel: this.store.createChannel(opts) };
  }

  getChannel(id: string): Channel | undefined {
    return this.store.getChannel(id);
  }

  deleteChannel(id: string): void {
    this.store.deleteChannel(id);
  }

  createInvite(
    channelId: string,
    opts: { ttlMs?: number | null; maxUses?: number | null } = {},
  ): Invite {
    return this.store.createInvite(channelId, opts);
  }

  getInvite(code: string): Invite | undefined {
    return this.store.getInvite(code);
  }

  findInviteForChannel(channelId: string): Invite | undefined {
    return this.store.findInviteForChannel(channelId);
  }

  resolve(
    input: { code?: string; slug?: string; channelId?: string },
    opts: { createMissingSlug?: boolean } = {},
  ) {
    return this.store.resolve(input, opts);
  }

  consumeInvite(code: string): void {
    this.store.consumeInvite(code);
  }

  /** Для /api/health: сколько всего лежит в каталоге. */
  counts(): { channels: number; invites: number } {
    const snapshot = this.store.snapshot();
    return { channels: snapshot.channels.length, invites: snapshot.invites.length };
  }
}
