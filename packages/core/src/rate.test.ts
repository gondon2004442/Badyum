import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter } from "./rate.ts";

/** Управляемое время: ждать реальные секунды в тестах незачем. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("ограничение частоты", () => {
  it("пропускает до лимита и отказывает после", () => {
    const limiter = new RateLimiter(3, 1000, clock().now);

    assert.equal(limiter.allow("a"), true);
    assert.equal(limiter.allow("a"), true);
    assert.equal(limiter.allow("a"), true);
    assert.equal(limiter.allow("a"), false);
  });

  it("считает ключи независимо", () => {
    const limiter = new RateLimiter(1, 1000, clock().now);

    assert.equal(limiter.allow("a"), true);
    assert.equal(limiter.allow("b"), true, "чужой лимит не должен влиять");
    assert.equal(limiter.allow("a"), false);
  });

  it("окно скользит: старые попытки перестают считаться", () => {
    const c = clock();
    const limiter = new RateLimiter(2, 1000, c.now);

    assert.equal(limiter.allow("a"), true);
    assert.equal(limiter.allow("a"), true);
    assert.equal(limiter.allow("a"), false);

    c.advance(1001);
    assert.equal(limiter.allow("a"), true, "через окно должно снова пускать");
  });

  /**
   * Отказ не должен продлевать окно. Иначе тот, кто долбится в закрытую дверь,
   * держал бы себя заблокированным бесконечно — а это ровно то поведение,
   * которое человек воспроизводит, нажимая кнопку ещё раз.
   */
  it("отказы не удлиняют блокировку", () => {
    const c = clock();
    const limiter = new RateLimiter(1, 1000, c.now);

    assert.equal(limiter.allow("a"), true);
    c.advance(500);
    assert.equal(limiter.allow("a"), false);
    assert.equal(limiter.allow("a"), false);
    assert.equal(limiter.allow("a"), false);

    // Первая попытка была в 0, окно 1000 — в 1001 она должна выпасть.
    c.advance(501);
    assert.equal(limiter.allow("a"), true);
  });

  it("показывает остаток", () => {
    const limiter = new RateLimiter(3, 1000, clock().now);

    assert.equal(limiter.remaining("a"), 3);
    limiter.allow("a");
    assert.equal(limiter.remaining("a"), 2);
    limiter.allow("a");
    limiter.allow("a");
    assert.equal(limiter.remaining("a"), 0);
  });

  it("забытый ключ начинает с нуля", () => {
    const limiter = new RateLimiter(1, 1000, clock().now);

    limiter.allow("a");
    assert.equal(limiter.allow("a"), false);

    limiter.forget("a");
    assert.equal(limiter.allow("a"), true);
  });
});
