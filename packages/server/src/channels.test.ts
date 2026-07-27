import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelStore } from "./channels.ts";
import { CODE_ALPHABET, generateInviteCode, normalizeInviteCode, normalizeSlug } from "./ids.ts";

describe("инвайт-коды", () => {
  it("генерирует коды только из безопасного алфавита", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      assert.equal(code.length, 6);
      for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `неожиданный символ ${ch}`);
    }
  });

  it("никогда не выдаёт символы, которые путают при чтении", () => {
    const forbidden = ["0", "1", "o", "i", "l"];
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      for (const ch of forbidden) assert.ok(!code.includes(ch), `${code} содержит ${ch}`);
    }
  });

  it("нормализует регистр и вытаскивает код из вставленной ссылки", () => {
    assert.equal(normalizeInviteCode("X7K2MQ"), "x7k2mq");
    assert.equal(normalizeInviteCode("  x7k2mq  "), "x7k2mq");
    assert.equal(normalizeInviteCode("https://badyum.app/j/x7k2mq"), "x7k2mq");
    assert.equal(normalizeInviteCode("badyum.app/j/x7k2mq?from=tg"), "x7k2mq");
  });

  it("отвергает мусор и коды неверной длины", () => {
    assert.equal(normalizeInviteCode("x7k2m"), null);
    assert.equal(normalizeInviteCode("x7k2mqq"), null);
    assert.equal(normalizeInviteCode("x7k2m0"), null);
    assert.equal(normalizeInviteCode(""), null);
  });
});

describe("кодовые слова", () => {
  it("приводит фразу к slug и не теряет кириллицу", () => {
    assert.equal(normalizeSlug("Badyum Катка!"), "badyum-катка");
    assert.equal(normalizeSlug("  вечерний   рейд  "), "вечерний-рейд");
    assert.equal(normalizeSlug("a__b"), "a-b");
  });

  it("отвергает слишком короткие слова", () => {
    assert.equal(normalizeSlug("ab"), null);
    assert.equal(normalizeSlug("!!!"), null);
  });
});

describe("резолвер каналов", () => {
  it("по инвайту приводит в тот же канал", () => {
    const store = new ChannelStore();
    const channel = store.createChannel({ name: "Катка" });
    const invite = store.createInvite(channel.id);

    const result = store.resolve({ code: invite.code.toUpperCase() });
    assert.ok(result.ok);
    assert.equal(result.value.channel.id, channel.id);
    assert.equal(result.value.source, "invite");
  });

  it("отклоняет истёкший инвайт", () => {
    const store = new ChannelStore();
    const channel = store.createChannel({ name: "Катка" });
    const invite = store.createInvite(channel.id, { ttlMs: -1 });

    const result = store.resolve({ code: invite.code });
    assert.ok(!result.ok);
    assert.equal(result.error, "invite_expired");
  });

  it("отклоняет инвайт, исчерпавший лимит использований", () => {
    const store = new ChannelStore();
    const channel = store.createChannel({ name: "Катка" });
    const invite = store.createInvite(channel.id, { maxUses: 1 });

    assert.ok(store.resolve({ code: invite.code }).ok);
    store.consumeInvite(invite.code);

    const second = store.resolve({ code: invite.code });
    assert.ok(!second.ok);
    assert.equal(second.error, "invite_exhausted");
  });

  it("по кодовому слову: первый создаёт канал, второй попадает в него же", () => {
    const store = new ChannelStore();

    const first = store.resolve({ slug: "Badyum Катка" }, { createMissingSlug: true });
    assert.ok(first.ok);
    assert.equal(first.value.channel.ephemeral, true);

    const second = store.resolve({ slug: "badyum-катка" }, { createMissingSlug: true });
    assert.ok(second.ok);
    assert.equal(second.value.channel.id, first.value.channel.id);
  });

  it("не создаёт канал по слову, если это только предпросмотр", () => {
    const store = new ChannelStore();
    const result = store.resolve({ slug: "никого-нет" }, { createMissingSlug: false });
    assert.ok(!result.ok);
    assert.equal(result.error, "not_found");
  });

  it("удаление канала уносит его инвайты и освобождает слово", () => {
    const store = new ChannelStore();
    const channel = store.createChannel({ name: "тест", slug: "тест-слово", ephemeral: true });
    const invite = store.createInvite(channel.id);

    store.deleteChannel(channel.id);

    assert.equal(store.getInvite(invite.code), undefined);
    const reused = store.resolve({ slug: "тест-слово" }, { createMissingSlug: true });
    assert.ok(reused.ok);
    assert.notEqual(reused.value.channel.id, channel.id);
  });
});
