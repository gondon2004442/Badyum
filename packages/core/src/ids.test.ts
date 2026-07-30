import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateInviteCode,
  generateTag,
  normalizeDisplayName,
  normalizeInviteCode,
  normalizeSlug,
} from "./ids.ts";

describe("инвайт-коды", () => {
  it("нужной длины и только из своего алфавита", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      assert.equal(code.length, CODE_LENGTH);
      for (const ch of code) {
        assert.ok(CODE_ALPHABET.includes(ch), `посторонний символ ${ch} в ${code}`);
      }
    }
  });

  /**
   * Проверка на смещение генератора.
   *
   * Случайность берётся из getRandomValues с отбрасыванием неполного блока.
   * Ошибка в этой арифметике не ломает ничего заметного — просто часть алфавита
   * начинает выпадать чаще, а коды становятся предсказуемее. Без такого теста
   * это никогда не всплывёт.
   */
  it("распределены по алфавиту без явного перекоса", () => {
    const counts = new Map<string, number>();
    const draws = CODE_ALPHABET.length * 400;
    for (let i = 0; i < draws / CODE_LENGTH; i += 1) {
      for (const ch of generateInviteCode()) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }

    assert.equal(counts.size, CODE_ALPHABET.length, "не все символы встретились");

    const expected = draws / CODE_ALPHABET.length;
    for (const [ch, n] of counts) {
      // Границы широкие намеренно: ловим сломанную арифметику, а не шум.
      assert.ok(
        n > expected * 0.5 && n < expected * 1.5,
        `символ ${ch} выпал ${n} раз при ожидаемых ~${expected}`,
      );
    }
  });
});

describe("нормализация ввода", () => {
  it("достаёт код из вставленной целиком ссылки с параметрами", () => {
    assert.equal(normalizeInviteCode("https://badyum.ru/j/x7k2mq?from=tg"), "x7k2mq");
  });

  it("не принимает символы, выброшенные из алфавита", () => {
    // 0, 1, l, i и o убраны как раз потому, что их путают на слух.
    assert.equal(normalizeInviteCode("x7k2m0"), null);
  });

  it("кодовое слово сохраняет кириллицу", () => {
    assert.equal(normalizeSlug("  Badyum Катка! "), "badyum-катка");
  });

  it("имя чистится от управляющих и невидимых символов", () => {
    // Escape-последовательностями, а не самими байтами: невидимка в исходнике
    // превращает тест в загадку, а файл — в «binary file matches» для grep.
    assert.equal(normalizeDisplayName("\u0000\u200bдюма\u0000"), "дюма");
    assert.equal(normalizeDisplayName("   дюма   "), "дюма");
    // Обычный пробел внутри имени — не мусор, его не трогаем.
    assert.equal(normalizeDisplayName("ду макс"), "ду макс");
    // Из одних невидимок имени не выйдет.
    assert.equal(normalizeDisplayName(" \u200b\u0000"), null);
  });
});

describe("тег к нику", () => {
  it("всегда четыре цифры", () => {
    for (let i = 0; i < 300; i += 1) {
      assert.match(generateTag(), /^\d{4}$/);
    }
  });
});
