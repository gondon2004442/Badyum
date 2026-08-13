import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ReportBudget,
  redactPath,
  signatureOf,
  trimMessage,
  trimStack,
} from "./report.ts";

const draft = (message: string, stack?: string) => ({
  kind: "onerror",
  message,
  stack,
});

describe("отпечаток ошибки", () => {
  it("одинаковый у повторов", () => {
    const a = draft("Cannot read properties of null", "Error\n    at join (a.js:12:3)");
    const b = draft("Cannot read properties of null", "Error\n    at join (a.js:12:3)");
    assert.equal(signatureOf(a), signatureOf(b));
  });

  it("разный у разного текста", () => {
    assert.notEqual(signatureOf(draft("одно")), signatureOf(draft("другое")));
  });

  it("разный у одного текста из разных мест", () => {
    const a = draft("нет микрофона", "Error\n    at join (a.js:12:3)");
    const b = draft("нет микрофона", "Error\n    at leave (a.js:40:1)");
    assert.notEqual(
      signatureOf(a),
      signatureOf(b),
      "иначе вторая поломка спряталась бы за первой",
    );
  });

  it("не зависит от кадров глубже первого", () => {
    const a = draft("бух", "Error\n    at f (a.js:1:1)\n    at g (b.js:2:2)");
    const b = draft("бух", "Error\n    at f (a.js:1:1)\n    at h (c.js:9:9)");
    assert.equal(
      signatureOf(a),
      signatureOf(b),
      "одна поломка, пришедшая двумя путями, — это одна поломка",
    );
  });

  it("переживает отсутствие стека", () => {
    assert.equal(typeof signatureOf(draft("без стека")), "string");
  });
});

describe("обрезка", () => {
  it("схлопывает пробелы и режет длинное", () => {
    assert.equal(trimMessage("  два   слова \n"), "два слова");
    const long = trimMessage("я".repeat(500));
    assert.ok(long.length <= 301, `получилось ${long.length}`);
    assert.ok(long.endsWith("…"));
  });

  it("оставляет от стека верхушку", () => {
    const stack = Array.from({ length: 30 }, (_, i) => `    at f${i} ()`).join("\n");
    assert.equal(trimStack(stack)?.split("\n").length, 6);
  });

  it("не выдумывает стек, которого нет", () => {
    assert.equal(trimStack(undefined), undefined);
  });
});

describe("адрес страницы", () => {
  it("прячет инвайт-код и кодовое слово", () => {
    assert.equal(redactPath("https://badyum.ru/j/x7k2mq"), "/j/…");
    assert.equal(redactPath("https://badyum.ru/r/badyum-катка"), "/r/…");
  });

  it("оставляет обычные экраны как есть", () => {
    assert.equal(redactPath("https://badyum.ru/"), "/");
    assert.equal(redactPath("https://badyum.ru/settings"), "/settings");
  });

  it("выбрасывает параметры вместе с остальным адресом", () => {
    assert.equal(
      redactPath("https://badyum.ru/j/abc?token=secret"),
      "/j/…",
      "токен в query — такой же ключ, как код в пути",
    );
  });

  it("не падает на мусоре вместо адреса", () => {
    assert.equal(redactPath("не адрес"), "не адрес");
  });
});

describe("сколько ошибок вкладка вправе отправить", () => {
  it("пропускает разные и глушит повторы", () => {
    const budget = new ReportBudget(5);
    assert.equal(budget.admit(draft("раз")), true);
    assert.equal(budget.admit(draft("раз")), false, "повтор молчит");
    assert.equal(budget.admit(draft("два")), true);
  });

  it("держит потолок", () => {
    const budget = new ReportBudget(2);
    assert.equal(budget.admit(draft("a")), true);
    assert.equal(budget.admit(draft("b")), true);
    assert.equal(budget.admit(draft("c")), false);
    assert.equal(budget.left, 0);
  });

  it("не тратит потолок на повторы", () => {
    const budget = new ReportBudget(2);
    budget.admit(draft("зациклилась"));
    for (let i = 0; i < 100; i += 1) budget.admit(draft("зациклилась"));

    assert.equal(
      budget.admit(draft("настоящая причина")),
      true,
      "иначе лавина повторов вытеснила бы то, ради чего всё затевалось",
    );
  });
});
