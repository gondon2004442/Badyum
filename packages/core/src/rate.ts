/**
 * Ограничение частоты по скользящему окну.
 *
 * Считает попытки за последние `windowMs` и отказывает, когда их больше `limit`.
 * Скользящее окно, а не фиксированные интервалы: на границе фиксированных можно
 * сделать двойную норму за мгновение, просто попав в стык.
 *
 * Состояние держится в памяти. Для Durable Object этого достаточно — он
 * единственный обработчик своего канала, и переживший засыпание счётчик означал
 * бы, что человек, вернувшийся через час, всё ещё «частит».
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Пропускает попытку и засчитывает её, либо отказывает не засчитывая. */
  allow(key: string): boolean {
    const now = this.now();
    const times = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);

    if (times.length >= this.limit) {
      // Отказ не продлевает окно: иначе тот, кто долбится в закрытую дверь,
      // держал бы себя заблокированным вечно.
      this.hits.set(key, times);
      return false;
    }

    times.push(now);
    this.hits.set(key, times);
    return true;
  }

  /** Сколько попыток осталось прямо сейчас. Нужно для заголовков и диагностики. */
  remaining(key: string): number {
    const now = this.now();
    const times = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return Math.max(0, this.limit - times.length);
  }

  /** Забыть ключ — например, когда участник ушёл из канала. */
  forget(key: string): void {
    this.hits.delete(key);
  }
}
