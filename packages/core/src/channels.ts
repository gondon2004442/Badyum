import {
  generateInviteCode,
  newChannelId,
  normalizeInviteCode,
  normalizeSlug,
} from "./ids.ts";

export interface Channel {
  id: string;
  name: string;
  /** Кодовое слово, если канал заявлен через /r/<slug>. */
  slug: string | null;
  /** Эфемерный канал исчезает, когда из него вышел последний участник. */
  ephemeral: boolean;
  createdAt: number;
}

export interface Invite {
  code: string;
  channelId: string;
  expiresAt: number | null;
  /** null — без лимита. */
  maxUses: number | null;
  uses: number;
}

/** Что именно распознали во вводе — нужно только для диагностики и логов. */
export type ResolveSource = "invite" | "slug" | "channel_id";

export interface Resolved {
  channel: Channel;
  source: ResolveSource;
}

export type ResolveError =
  | "not_found"
  | "invite_expired"
  | "invite_exhausted"
  | "bad_input";

const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Хранилище каналов в памяти.
 *
 * Все четыре способа связи (ссылка, QR, кодовое слово, канал по id) сходятся
 * в `resolve` и дальше идут одним и тем же путём входа. Это сознательно: любой
 * новый способ добавляется здесь и больше нигде.
 *
 * Переезд на SQLite — замена этого класса, интерфейс остаётся тот же.
 */
export class ChannelStore {
  private readonly channels = new Map<string, Channel>();
  private readonly invites = new Map<string, Invite>();
  private readonly bySlug = new Map<string, string>();

  createChannel(opts: { name: string; slug?: string | null; ephemeral?: boolean }): Channel {
    const channel: Channel = {
      id: newChannelId(),
      name: opts.name,
      slug: opts.slug ?? null,
      ephemeral: opts.ephemeral ?? false,
      createdAt: Date.now(),
    };
    this.channels.set(channel.id, channel);
    if (channel.slug) this.bySlug.set(channel.slug, channel.id);
    return channel;
  }

  getChannel(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  deleteChannel(id: string): void {
    const channel = this.channels.get(id);
    if (!channel) return;
    if (channel.slug) this.bySlug.delete(channel.slug);
    this.channels.delete(id);
    for (const [code, invite] of this.invites) {
      if (invite.channelId === id) this.invites.delete(code);
    }
  }

  createInvite(
    channelId: string,
    opts: { ttlMs?: number | null; maxUses?: number | null } = {},
  ): Invite {
    let code = generateInviteCode();
    // Коллизия на 31^6 маловероятна, но проверить дешевле, чем разбираться,
    // почему двое оказались в разных каналах по одной ссылке.
    while (this.invites.has(code)) code = generateInviteCode();

    const ttl = opts.ttlMs === undefined ? DEFAULT_INVITE_TTL_MS : opts.ttlMs;
    const invite: Invite = {
      code,
      channelId,
      expiresAt: ttl === null ? null : Date.now() + ttl,
      maxUses: opts.maxUses ?? null,
      uses: 0,
    };
    this.invites.set(code, invite);
    return invite;
  }

  getInvite(code: string): Invite | undefined {
    return this.invites.get(code);
  }

  /** Инвайты для канала — чтобы экран канала показал существующую ссылку, а не плодил новые. */
  findInviteForChannel(channelId: string): Invite | undefined {
    for (const invite of this.invites.values()) {
      if (invite.channelId !== channelId) continue;
      if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) continue;
      if (invite.maxUses !== null && invite.uses >= invite.maxUses) continue;
      return invite;
    }
    return undefined;
  }

  /**
   * Единственная точка входа: что бы человек ни ввёл — код из ссылки, QR
   * (это та же ссылка), кодовое слово или id канала — здесь это становится
   * каналом.
   *
   * `createMissingSlug` включает сценарий "оба ввели одно слово": первый
   * создаёт эфемерный канал, второй попадает в уже существующий.
   */
  resolve(
    input: { code?: string; slug?: string; channelId?: string },
    opts: { createMissingSlug?: boolean } = {},
  ): { ok: true; value: Resolved } | { ok: false; error: ResolveError } {
    if (input.code !== undefined) {
      const code = normalizeInviteCode(input.code);
      if (!code) return { ok: false, error: "bad_input" };

      const invite = this.invites.get(code);
      if (!invite) return { ok: false, error: "not_found" };
      if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) {
        return { ok: false, error: "invite_expired" };
      }
      if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
        return { ok: false, error: "invite_exhausted" };
      }

      const channel = this.channels.get(invite.channelId);
      if (!channel) return { ok: false, error: "not_found" };
      return { ok: true, value: { channel, source: "invite" } };
    }

    if (input.slug !== undefined) {
      const slug = normalizeSlug(input.slug);
      if (!slug) return { ok: false, error: "bad_input" };

      const existingId = this.bySlug.get(slug);
      if (existingId) {
        const channel = this.channels.get(existingId);
        if (channel) return { ok: true, value: { channel, source: "slug" } };
      }

      if (!opts.createMissingSlug) return { ok: false, error: "not_found" };
      const channel = this.createChannel({ name: slug, slug, ephemeral: true });
      return { ok: true, value: { channel, source: "slug" } };
    }

    if (input.channelId !== undefined) {
      const channel = this.channels.get(input.channelId);
      if (!channel) return { ok: false, error: "not_found" };
      return { ok: true, value: { channel, source: "channel_id" } };
    }

    return { ok: false, error: "bad_input" };
  }

  /**
   * Считаем использование инвайта только когда человек реально вошёл в канал,
   * а не когда открыл страницу: иначе лимит съедают превью ссылок в мессенджерах.
   */
  consumeInvite(code: string): void {
    const invite = this.invites.get(code);
    if (invite) invite.uses += 1;
  }
}
