import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeUsername, suggestUsername, usernameKey } from "./username.ts";

const problemOf = (raw: string) => {
  const result = normalizeUsername(raw);
  return result.ok ? null : result.problem;
};

const okOf = (raw: string) => {
  const result = normalizeUsername(raw);
  return result.ok ? result.username : null;
};

describe("каким может быть юз", () => {
  it("пропускает обычные", () => {
    assert.equal(okOf("dumax"), "dumax");
    assert.equal(okOf("du.max"), "du.max");
    assert.equal(okOf("du_max_2"), "du_max_2");
    assert.equal(okOf("Dumax"), "Dumax", "регистр человек выбирает сам");
  });

  it("срезает пробелы по краям — это след копирования, а не намерение", () => {
    assert.equal(okOf("  dumax  "), "dumax");
  });

  it("не пускает слишком короткие и слишком длинные", () => {
    assert.equal(problemOf("ab"), "too_short");
    assert.equal(problemOf("a".repeat(21)), "too_long");
    assert.equal(okOf("abc"), "abc");
    assert.equal(okOf("a".repeat(20)), "a".repeat(20));
  });

  it("не пускает кириллицу", () => {
    // Не вкусовщина: «а», «е», «о», «р», «с» неотличимы от латинских, и
    // «дumax» рядом с «dumax» — способ выдать себя за другого.
    assert.equal(problemOf("дюма"), "bad_chars");
    assert.equal(problemOf("дumax"), "bad_chars");
  });

  it("не пускает пробелы, эмодзи и решётку", () => {
    assert.equal(problemOf("du max"), "bad_chars");
    assert.equal(problemOf("dumax🔥"), "bad_chars");
    assert.equal(problemOf("dumax#4821"), "bad_chars");
  });

  it("не пускает разделитель по краям", () => {
    assert.equal(problemOf(".dumax"), "bad_edges");
    assert.equal(problemOf("dumax_"), "bad_edges");
  });

  it("не пускает два разделителя подряд", () => {
    // «du..max» и «du.max» глазом не различаются.
    assert.equal(problemOf("du..max"), "double_separator");
    assert.equal(problemOf("du._max"), "double_separator");
  });

  it("не отдаёт слова сервиса", () => {
    assert.equal(problemOf("badyum"), "reserved");
    assert.equal(problemOf("Support"), "reserved", "регистр тут не спасает");
  });
});

describe("когда юз считается занятым", () => {
  it("не различает регистр", () => {
    assert.equal(usernameKey("Dumax"), usernameKey("dumax"));
  });

  it("но различает разные юзы", () => {
    assert.notEqual(usernameKey("dumax"), usernameKey("du_max"));
  });
});

describe("что предложить при первом входе", () => {
  it("берёт латинское имя как есть", () => {
    assert.equal(suggestUsername("Dumax"), "Dumax");
  });

  it("склеивает имя и фамилию", () => {
    assert.equal(suggestUsername("John Smith"), "John_Smith");
  });

  it("снимает диакритику, а не выбрасывает букву", () => {
    assert.equal(suggestUsername("Renée"), "Renee");
  });

  it("не предлагает ничего, если предлагать нечего", () => {
    // Кириллическое имя после чистки даёт пустоту, а подставлять человеку
    // мусор хуже, чем оставить поле пустым.
    assert.equal(suggestUsername("Максим"), null);
    assert.equal(suggestUsername("🔥🔥🔥"), null);
  });

  it("не предлагает то, что сам бы не принял", () => {
    const suggestion = suggestUsername("...J...");
    assert.equal(suggestion, null, "«J» короче трёх символов");
  });
});
