import { CHAT_HISTORY_LIMIT, type ChatMessage } from "@badyum/shared";

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
 * История живёт в памяти и намеренно короткая: это разговор рядом с голосом,
 * а не архив переписки. Пережить перезапуск сервера она не должна — как и сам
 * эфемерный канал.
 */
export class ChatLog {
  private readonly byChannel = new Map<string, ChatMessage[]>();
  /** userId -> времена последних сообщений, для ограничения частоты. */
  private readonly recent = new Map<string, number[]>();

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
    if (!this.allow(sender.userId)) return { ok: false, error: "too_fast" };

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
    this.recent.delete(userId);
  }

  private allow(userId: string): boolean {
    const now = Date.now();
    const times = (this.recent.get(userId) ?? []).filter(
      (t) => now - t < RATE_WINDOW_MS,
    );

    if (times.length >= RATE_LIMIT) {
      this.recent.set(userId, times);
      return false;
    }

    times.push(now);
    this.recent.set(userId, times);
    return true;
  }
}
