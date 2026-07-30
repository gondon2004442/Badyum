import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_HISTORY_LIMIT } from "@badyum/shared";
import { ChatLog } from "./chat.ts";

const sender = (userId = "u1") => ({ userId, displayName: userId });

describe("чат канала", () => {
  it("сохраняет сообщение и отдаёт его в истории", () => {
    const chat = new ChatLog();
    const result = chat.append("ch1", sender(), "привет");

    assert.ok(result.ok);
    assert.equal(result.message.text, "привет");
    assert.equal(chat.history("ch1").length, 1);
  });

  it("чистит управляющие символы, но сохраняет переводы строк", () => {
    const chat = new ChatLog();
    const result = chat.append("ch1", sender(), "строка\nвторая");

    assert.ok(result.ok);
    assert.equal(result.message.text, "строка\nвторая");
  });

  it("схлопывает простыню из переводов строк", () => {
    const chat = new ChatLog();
    const result = chat.append("ch1", sender(), "верх\n\n\n\n\n\nниз");

    assert.ok(result.ok);
    assert.equal(result.message.text, "верх\n\nниз");
  });

  it("отклоняет сообщение, в котором после чистки ничего не осталось", () => {
    const chat = new ChatLog();
    const result = chat.append("ch1", sender(), "   \n\u0000\n  ");

    assert.ok(!result.ok);
    assert.equal(result.error, "empty");
    assert.equal(chat.history("ch1").length, 0);
  });

  it("не даёт частить: девятое подряд сообщение отклоняется", () => {
    const chat = new ChatLog();
    for (let i = 0; i < 8; i += 1) {
      assert.ok(chat.append("ch1", sender(), `раз ${i}`).ok, `сообщение ${i} должно пройти`);
    }

    const blocked = chat.append("ch1", sender(), "девятое");
    assert.ok(!blocked.ok);
    assert.equal(blocked.error, "too_fast");
  });

  it("ограничение частоты не задевает соседа", () => {
    const chat = new ChatLog();
    for (let i = 0; i < 8; i += 1) chat.append("ch1", sender("u1"), `раз ${i}`);

    assert.ok(chat.append("ch1", sender("u2"), "а я только пришёл").ok);
  });

  it("история не растёт бесконечно", () => {
    const chat = new ChatLog();
    // Обходим ограничение частоты: важно поведение обрезки, а не троттлинг.
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 20; i += 1) {
      chat.append("ch1", sender(`u${i}`), `сообщение ${i}`);
    }

    const history = chat.history("ch1");
    assert.equal(history.length, CHAT_HISTORY_LIMIT);
    // Остался именно хвост, а не начало переписки
    assert.equal(history[history.length - 1]?.text, `сообщение ${CHAT_HISTORY_LIMIT + 19}`);
  });

  it("каналы не видят чужую переписку", () => {
    const chat = new ChatLog();
    chat.append("ch1", sender(), "только для первого");

    assert.equal(chat.history("ch2").length, 0);
  });

  it("канал исчез — переписка вместе с ним", () => {
    const chat = new ChatLog();
    chat.append("ch1", sender(), "было да сплыло");
    chat.clear("ch1");

    assert.equal(chat.history("ch1").length, 0);
  });
});
