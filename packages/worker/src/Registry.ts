import { DurableObject } from "cloudflare:workers";
import {
  ChannelGate,
  ChannelStore,
  pairOf,
  type Channel,
  type ChannelSink,
  type Creator,
  type Invite,
} from "@badyum/core";

const CHANNEL_PREFIX = "ch:";
const INVITE_PREFIX = "inv:";
/** Личный канал пары: ключ — оба идентификатора в каноническом порядке. */
const DIRECT_PREFIX = "dm:";

const directKey = (x: string, y: string): string => {
  const { userA, userB } = pairOf(x, y);
  return `${userA}|${userB}`;
};

/**
 * Сколько каналов можно завести за час — на аккаунт, а не на адрес.
 *
 * Живой человек нажимает «Новый канал» несколько раз за вечер, так что двадцать
 * — это с запасом. Ограничение нужно не против него, а против цикла в консоли:
 * каждый канал занимает место в хранилище каталога навсегда. Требование войти
 * делает такой цикл дорогим, а этот лимит — ещё и медленным.
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
   * Право заводить каналы и счётчик частоты.
   *
   * Счётчик держится в памяти и не переживает засыпание объекта. Это осознанно:
   * хранить его — значит писать в хранилище на каждое нажатие кнопки, а цена
   * промаха здесь всего лишь ещё двадцать каналов у настойчивого скрипта.
   */
  private readonly gate: ChannelGate;
  /** Пара → её личный канал. Держим в памяти, зеркалим в хранилище. */
  private readonly direct = new Map<string, string>();

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
    this.gate = new ChannelGate(this.store, CHANNELS_PER_HOUR, HOUR_MS);

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

      const direct = await ctx.storage.list<string>({ prefix: DIRECT_PREFIX });
      for (const [key, id] of direct) this.direct.set(key.slice(DIRECT_PREFIX.length), id);
    });
  }

  // Дальше — ровно тот же интерфейс, что у ChannelStore. Обёртки существуют
  // потому, что через RPC вызываются только объявленные методы, а не класс
  // целиком.

  createChannel(opts: { name: string; slug?: string | null; ephemeral?: boolean }): Channel {
    return this.store.createChannel(opts);
  }

  /**
   * Создание канала по запросу извне — с правом и ограничением частоты.
   *
   * `caller === null` означает «права нет»: кто его имеет, решает Worker, а
   * правило целиком живёт в ChannelGate.
   */
  createChannelFor(caller: Creator, opts: { name: string; slug?: string | null }) {
    return this.gate.create(caller, opts);
  }

  /**
   * Личный канал пары — один и тот же навсегда.
   *
   * Раньше каждый звонок заводил новый канал. От этого переписка с человеком
   * начиналась с нуля после каждого разговора, а в списке каналов копились
   * одноразовые «Аня и Боря». Здесь пара получает один канал: в нём и переписка,
   * и звонок, и он же открывается по нажатию на контакт.
   *
   * Лимит на создание сюда не относится: канал один на пару и появляется не по
   * нажатию кнопки, а потому что двое уже друг друга добавили. Считать его
   * «созданием» значило бы наказывать за то, что у человека много друзей.
   *
   * Инвайт бессрочный. Обычные семь дней здесь означали бы, что через неделю
   * пара не может войти в собственную переписку.
   */
  directChannel(a: string, b: string, name: string): { channel: Channel; invite: Invite } {
    const key = directKey(a, b);

    const known = this.direct.get(key);
    const existing = known ? this.store.getChannel(known) : undefined;
    if (existing) {
      const invite =
        this.store.findInviteForChannel(existing.id) ??
        this.store.createInvite(existing.id, { ttlMs: null });
      return { channel: existing, invite };
    }

    const channel = this.store.createChannel({ name, ephemeral: false });
    const invite = this.store.createInvite(channel.id, { ttlMs: null });

    this.direct.set(key, channel.id);
    void this.ctx.storage.put(DIRECT_PREFIX + key, channel.id);

    return { channel, invite };
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

  /** Только поиск, без создания: этим живёт предпросмотр канала до входа. */
  resolve(input: { code?: string; slug?: string; channelId?: string }) {
    return this.store.resolve(input, { createMissingSlug: false });
  }

  /**
   * Вход: существующий канал отдаётся всем, свободное слово превращается в
   * канал только для того, у кого есть на это право.
   */
  resolveFor(caller: Creator, input: { code?: string; slug?: string; channelId?: string }) {
    return this.gate.resolve(caller, input);
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
