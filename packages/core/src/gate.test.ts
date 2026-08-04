import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelStore } from "./channels.ts";
import { ChannelGate } from "./gate.ts";

/** Управляемое время: ждать реальный час в тестах незачем. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

const gateWith = (limit = 3, windowMs = 1000, now = Date.now) => {
  const store = new ChannelStore();
  return { store, gate: new ChannelGate(store, limit, windowMs, now) };
};

describe("право заводить каналы", () => {
  it("не даёт гостю создать канал", () => {
    const { gate, store } = gateWith();

    const result = gate.create(null, { name: "Новый канал" });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, "auth_required");
    assert.equal(store.snapshot().channels.length, 0, "отказ не должен ничего создавать");
  });

  it("даёт вошедшему", () => {
    const { gate } = gateWith();

    const result = gate.create("u:1", { name: "Новый канал" });

    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.channel.name, "Новый канал");
  });

  it("считает лимит по каждому отдельно", () => {
    const { gate } = gateWith(1);

    assert.equal(gate.create("u:1", { name: "первый" }).ok, true);
    assert.equal(gate.create("u:1", { name: "второй" }).ok, false);
    assert.equal(gate.create("u:2", { name: "чужой" }).ok, true, "лимит соседа не должен мешать");
  });

  it("отпускает, когда окно прошло", () => {
    const time = clock();
    const { gate } = gateWith(1, 1000, time.now);

    assert.equal(gate.create("u:1", { name: "первый" }).ok, true);
    assert.equal(gate.create("u:1", { name: "второй" }).ok, false);

    time.advance(1001);
    assert.equal(gate.create("u:1", { name: "второй" }).ok, true);
  });

  it("отказ не съедает попытку", () => {
    const { gate } = gateWith(2);

    gate.create("u:1", { name: "первый" });
    assert.equal(gate.remaining("u:1"), 1);

    // Гость промахивается мимо чужого ключа — на счётчик вошедшего это не влияет.
    gate.create(null, { name: "мимо" });
    assert.equal(gate.remaining("u:1"), 1);
  });
});

describe("вход по слову против создания по слову", () => {
  it("гость входит в существующий канал по слову", () => {
    const { gate, store } = gateWith();
    store.createChannel({ name: "катка", slug: "катка", ephemeral: true });

    const result = gate.resolve(null, { slug: "катка" });

    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.value.channel.slug, "катка");
  });

  it("гость не заводит канал по свободному слову", () => {
    const { gate, store } = gateWith();

    const result = gate.resolve(null, { slug: "катка" });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, "auth_required");
    assert.equal(
      store.snapshot().channels.length,
      0,
      "иначе запрет на кнопку ничего не стоил бы: тот же цикл создавал бы каналы словами",
    );
  });

  it("вошедший заводит канал по свободному слову", () => {
    const { gate } = gateWith();

    const result = gate.resolve("u:1", { slug: "катка" });

    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.value.channel.slug, "катка");
  });

  it("второй по тому же слову попадает в тот же канал и не тратит лимит", () => {
    const { gate } = gateWith(1);

    const first = gate.resolve("u:1", { slug: "катка" });
    const second = gate.resolve("u:2", { slug: "катка" });

    assert.equal(first.ok && second.ok, true);
    assert.equal(
      first.ok === true && second.ok === true && first.value.channel.id === second.value.channel.id,
      true,
    );
    assert.equal(
      gate.remaining("u:2"),
      1,
      "вход в существующий канал — не создание, лимит трогать нельзя",
    );
  });

  it("упирается в лимит на словах так же, как на кнопке", () => {
    const { gate } = gateWith(1);

    assert.equal(gate.resolve("u:1", { slug: "первое" }).ok, true);

    const second = gate.resolve("u:1", { slug: "второе" });
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.error, "too_many");
  });

  it("не спрашивает права за ссылку и id — там нечего создавать", () => {
    const { gate, store } = gateWith();
    const channel = store.createChannel({ name: "канал" });
    const invite = store.createInvite(channel.id);

    const byInvite = gate.resolve(null, { code: invite.code });
    assert.equal(byInvite.ok, true, "гость по ссылке — основной способ входа");

    const byId = gate.resolve(null, { channelId: channel.id });
    assert.equal(byId.ok, true);

    const missing = gate.resolve(null, { code: "zzzzzz" });
    assert.equal(missing.ok, false);
    assert.equal(
      missing.ok === false && missing.error,
      "not_found",
      "несуществующая ссылка — это «нет такого», а не «войди»",
    );
  });

  it("протухшую ссылку не превращает в требование войти", () => {
    const { gate, store } = gateWith();
    const channel = store.createChannel({ name: "канал" });
    // Срок в прошлом: хранилище смотрит на настоящие часы, ждать нечего.
    const invite = store.createInvite(channel.id, { ttlMs: -1000 });

    const result = gate.resolve(null, { code: invite.code });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, "invite_expired");
  });
});
