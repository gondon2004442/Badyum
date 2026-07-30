import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelStore, type Channel, type Invite } from "./channels.ts";
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

/** Запоминает вызовы sink, чтобы проверять, что именно уходит в хранилище. */
function recordingSink() {
  const channels = new Map<string, Channel>();
  const invites = new Map<string, Invite>();
  return {
    channels,
    invites,
    sink: {
      saveChannel: (c: Channel) => void channels.set(c.id, { ...c }),
      removeChannel: (id: string) => void channels.delete(id),
      saveInvite: (i: Invite) => void invites.set(i.code, { ...i }),
      removeInvite: (code: string) => void invites.delete(code),
    },
  };
}

describe("сохранение состояния", () => {
  it("без sink работает как раньше", () => {
    const store = new ChannelStore();
    const channel = store.createChannel({ name: "тест" });
    assert.equal(store.getChannel(channel.id)?.name, "тест");
  });

  it("создание канала и инвайта уходит в хранилище", () => {
    const rec = recordingSink();
    const store = new ChannelStore(rec.sink);

    const channel = store.createChannel({ name: "катка" });
    const invite = store.createInvite(channel.id);

    assert.equal(rec.channels.get(channel.id)?.name, "катка");
    assert.equal(rec.invites.get(invite.code)?.channelId, channel.id);
  });

  it("использование инвайта пересохраняется, иначе лимит обнулялся бы при перезапуске", () => {
    const rec = recordingSink();
    const store = new ChannelStore(rec.sink);
    const channel = store.createChannel({ name: "катка" });
    const invite = store.createInvite(channel.id, { maxUses: 2 });

    store.consumeInvite(invite.code);

    assert.equal(rec.invites.get(invite.code)?.uses, 1);
  });

  it("удаление канала вычищает из хранилища и его, и его инвайты", () => {
    const rec = recordingSink();
    const store = new ChannelStore(rec.sink);
    const channel = store.createChannel({ name: "эфемерный", ephemeral: true });
    const invite = store.createInvite(channel.id);

    store.deleteChannel(channel.id);

    assert.equal(rec.channels.size, 0);
    assert.equal(rec.invites.size, 0, `остался инвайт ${invite.code}`);
  });

  it("после восстановления ссылка продолжает работать", () => {
    const first = new ChannelStore();
    const channel = first.createChannel({ name: "катка" });
    const invite = first.createInvite(channel.id, { maxUses: 5 });
    first.consumeInvite(invite.code);

    const second = new ChannelStore();
    second.hydrate(first.snapshot());

    const resolved = second.resolve({ code: invite.code });
    assert.ok(resolved.ok, "ссылка перестала работать после восстановления");
    assert.equal(resolved.value.channel.id, channel.id);
    // Счётчик использований тоже должен уцелеть, иначе лимит ничего не значит.
    assert.equal(second.getInvite(invite.code)?.uses, 1);
  });

  /**
   * Индекс по кодовому слову не хранится, а выводится из каналов. Если его не
   * пересобрать, канал по слову после перезапуска окажется «свободным», и двое
   * с одним словом попадут в разные каналы, не понимая почему.
   */
  it("после восстановления кодовое слово ведёт в тот же канал", () => {
    const first = new ChannelStore();
    const created = first.resolve({ slug: "катка" }, { createMissingSlug: true });
    assert.ok(created.ok);

    const second = new ChannelStore();
    second.hydrate(first.snapshot());

    const again = second.resolve({ slug: "катка" }, { createMissingSlug: true });
    assert.ok(again.ok);
    assert.equal(again.value.channel.id, created.value.channel.id);
    assert.equal(again.value.source, "slug");
  });

  it("восстановление заменяет содержимое, а не дополняет его", () => {
    const store = new ChannelStore();
    const stale = store.createChannel({ name: "старый" });

    store.hydrate({ channels: [], invites: [] });

    assert.equal(store.getChannel(stale.id), undefined);
  });
});
