import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPolite } from "@badyum/shared";
import { RoomRegistry, type Member } from "./rooms.ts";

const member = (userId: string, channelId = "ch1"): Member => ({
  channelId,
  userId,
  identityId: null,
  displayName: userId,
  muted: false,
  deafened: false,
  speaking: false,
  sharing: false,
});

describe("состояние комнаты", () => {
  it("новичок получает список тех, кто уже внутри, без себя", () => {
    const rooms = new RoomRegistry(8);
    rooms.join(member("a"));
    rooms.join(member("b"));

    const result = rooms.join(member("c"));
    assert.ok(result.ok);
    assert.deepEqual(
      result.others.map((m) => m.userId).sort(),
      ["a", "b"],
    );
    assert.equal(rooms.size("ch1"), 3);
  });

  it("не пускает сверх лимита mesh-топологии", () => {
    const rooms = new RoomRegistry(2);
    assert.ok(rooms.join(member("a")).ok);
    assert.ok(rooms.join(member("b")).ok);

    const third = rooms.join(member("c"));
    assert.ok(!third.ok);
    assert.equal(third.error, "channel_full");
    assert.equal(rooms.size("ch1"), 2);
  });

  it("повторный join тем же id отклоняется и не дублирует участника", () => {
    const rooms = new RoomRegistry(8);
    assert.ok(rooms.join(member("a")).ok);

    const again = rooms.join(member("a"));
    assert.ok(!again.ok);
    assert.equal(again.error, "already_joined");
    assert.equal(rooms.size("ch1"), 1);
  });

  it("комната исчезает, когда вышел последний", () => {
    const rooms = new RoomRegistry(8);
    rooms.join(member("a"));
    rooms.join(member("b"));

    assert.equal(rooms.leave("ch1", "a").remaining, 1);
    assert.equal(rooms.leave("ch1", "b").remaining, 0);
    assert.ok(rooms.isEmpty("ch1"));
  });

  it("выход того, кого нет, ничего не ломает", () => {
    const rooms = new RoomRegistry(8);
    const result = rooms.leave("ch-нет", "кто-то");
    assert.equal(result.removed, false);
    assert.equal(result.remaining, 0);
  });

  it("каналы изолированы друг от друга", () => {
    const rooms = new RoomRegistry(8);
    rooms.join(member("a", "ch1"));
    rooms.join(member("a", "ch2"));

    assert.equal(rooms.size("ch1"), 1);
    assert.equal(rooms.size("ch2"), 1);
    rooms.leave("ch1", "a");
    assert.equal(rooms.size("ch2"), 1);
  });
});

describe("мьюты", () => {
  it("оглохший автоматически замьючен — иначе он говорит, но не слышит ответа", () => {
    const rooms = new RoomRegistry(8);
    rooms.join(member("a"));

    const updated = rooms.setState("ch1", "a", { deafened: true });
    assert.ok(updated);
    assert.equal(updated.deafened, true);
    assert.equal(updated.muted, true);
  });

  it("замьюченный не может считаться говорящим", () => {
    const rooms = new RoomRegistry(8);
    rooms.join(member("a"));
    rooms.setState("ch1", "a", { speaking: true });

    const updated = rooms.setState("ch1", "a", { muted: true });
    assert.ok(updated);
    assert.equal(updated.speaking, false);
  });

  it("состояние отсутствующего участника не создаётся из воздуха", () => {
    const rooms = new RoomRegistry(8);
    assert.equal(rooms.setState("ch1", "призрак", { muted: true }), undefined);
  });
});

describe("возврат в канал", () => {
  it("участник остаётся в комнате, пока его не убрали явно", () => {
    // Сигналинг опирается на это: при возврате он видит userId в комнате и
    // перехватывает сессию вместо повторного join.
    const rooms = new RoomRegistry(8);
    rooms.join(member("a"));
    rooms.setState("ch1", "a", { muted: true });

    assert.ok(rooms.has("ch1", "a"));
    const again = rooms.join(member("a"));
    assert.ok(!again.ok);
    assert.equal(again.error, "already_joined");

    // Состояние переживает попытку повторного входа
    const found = rooms.members("ch1").find((m) => m.userId === "a");
    assert.equal(found?.muted, true);
  });

  it("вернувшийся не считается новым участником", () => {
    const rooms = new RoomRegistry(2);
    rooms.join(member("a"));
    rooms.join(member("b"));

    // Комната уже полна; возврат "a" не должен упереться в лимит,
    // потому что он и не выходил
    assert.ok(rooms.has("ch1", "a"));
    assert.equal(rooms.size("ch1"), 2);
  });
});

describe("perfect negotiation", () => {
  it("роли в паре всегда противоположны — иначе glare", () => {
    const ids = ["a", "b", "zzz", "0", "d4e5", "d4e6"];
    for (const x of ids) {
      for (const y of ids) {
        if (x === y) continue;
        assert.notEqual(
          isPolite(x, y),
          isPolite(y, x),
          `${x} и ${y} оба считают себя одинаково`,
        );
      }
    }
  });
});
