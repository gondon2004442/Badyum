import { CHAT_HISTORY_LIMIT, type ChatMessage } from "@badyum/shared";
import { RateLimiter } from "./rate.ts";

/** Не чаще стольких сообщений за окно — иначе один человек забивает канал. */
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10_000;

interface Sender {
  userId: string;
  displayName: string;
}

/**
 * Чат канала.
 *
 * История намеренно короткая: это разговор рядом с голосом, а не архив
 * переписки. Пережить смерть самого канала она не должна.
 *
 * Но пережить засыпание процесса — должна: Durable Object выгружается из памяти
 * между сообщениями, и без восстановления вернувшийся человек видел бы пустой
 * чат вместо того, что писали минуту назад.
 */
export class ChatLog {
  private readonly byChannel = new Map<string, ChatMessage[]>();
  private readonly limiter = new RateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

  /**
   * Восстановление истории канала.
   *
   * Ограничение длины применяется и здесь: снимок мог быть сделан старой
   * версией с другим лимитом, и незаметно раздувшийся чат уехал бы в welcome
   * каждому входящему.
   */
  hydrate(channelId: string, messages: ChatMessage[]): void {
    this.byChannel.set(channelId, messages.slice(-CHAT_HISTORY_LIMIT));
  }

  /**
   * Пропускает сообщение или отказывает, если человек частит.
   *
   * Текст чистится от управляющих символов и схлопывается по краям: иначе
   * сообщение из одних переводов строки растягивает чат у всех.
   */
  append(
    channelId: string,
    sender: Sender,
    rawText: string,
  ): { ok: true; message: ChatMessage } | { ok: false; error: "too_fast" | "empty" } {
    const text = rawText
      // Управляющие символы, кроме перевода строки: он в сообщении осмыслен.
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 2000);

    if (!text) return { ok: false, error: "empty" };
    if (!this.limiter.allow(sender.userId)) return { ok: false, error: "too_fast" };

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      userId: sender.userId,
      displayName: sender.displayName,
      text,
      at: Date.now(),
    };

    const log = this.byChannel.get(channelId) ?? [];
    log.push(message);
    // Держим ровно хвост: канал живёт долго, а память не резиновая.
    if (log.length > CHAT_HISTORY_LIMIT) log.splice(0, log.length - CHAT_HISTORY_LIMIT);
    this.byChannel.set(channelId, log);

    return { ok: true, message };
  }

  history(channelId: string): ChatMessage[] {
    return this.byChannel.get(channelId) ?? [];
  }

  /** Канал исчез — переписка вместе с ним. */
  clear(channelId: string): void {
    this.byChannel.delete(channelId);
  }

  forget(userId: string): void {
    this.limiter.forget(userId);
  }
}
