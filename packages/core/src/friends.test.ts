import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccept,
  newRequest,
  otherOf,
  pairOf,
  planRequest,
  relationFor,
  type Friendship,
} from "./friends.ts";

const ANNA = "u-anna";
const BORIS = "u-boris";

describe("пара в каноническом порядке", () => {
  it("не зависит от порядка аргументов", () => {
    assert.deepEqual(pairOf(ANNA, BORIS), pairOf(BORIS, ANNA));
  });

  it("складывает по возрастанию", () => {
    const { userA, userB } = pairOf(BORIS, ANNA);
    assert.equal(userA, ANNA);
    assert.equal(userB, BORIS);
  });
});

describe("как связь выглядит с двух сторон", () => {
  const pending = newRequest(ANNA, BORIS, 1000);

  it("одна и та же заявка исходящая для отправителя и входящая для второго", () => {
    assert.equal(relationFor(ANNA, BORIS, pending), "outgoing");
    assert.equal(relationFor(BORIS, ANNA, pending), "incoming");
  });

  it("принятая дружба симметрична", () => {
    const accepted: Friendship = { ...pending, status: "accepted" };
    assert.equal(relationFor(ANNA, BORIS, accepted), "friends");
    assert.equal(relationFor(BORIS, ANNA, accepted), "friends");
  });

  it("без записи — никто друг другу", () => {
    assert.equal(relationFor(ANNA, BORIS, null), "none");
  });

  it("сам себе — особый случай, а не «никто»", () => {
    assert.equal(relationFor(ANNA, ANNA, null), "self");
  });

  it("отдаёт второго участника с любой стороны", () => {
    assert.equal(otherOf(pending, ANNA), BORIS);
    assert.equal(otherOf(pending, BORIS), ANNA);
  });
});

describe("что делать с заявкой", () => {
  it("незнакомому — создать", () => {
    assert.deepEqual(planRequest(ANNA, BORIS, null), { action: "create" });
  });

  it("самому себе — нельзя", () => {
    assert.deepEqual(planRequest(ANNA, ANNA, null), { error: "self" });
  });

  it("повторно тому же — нельзя", () => {
    const sent = newRequest(ANNA, BORIS);
    assert.deepEqual(planRequest(ANNA, BORIS, sent), { error: "already_sent" });
  });

  it("уже другу — нельзя", () => {
    const accepted: Friendship = { ...newRequest(ANNA, BORIS), status: "accepted" };
    assert.deepEqual(planRequest(ANNA, BORIS, accepted), { error: "already_friends" });
  });

  it("встречная заявка — это согласие, а не вторая заявка", () => {
    // Двое добавили друг друга, не сговариваясь. Если бы здесь создавалась
    // вторая строка, оба остались бы с исходящей заявкой и ждали друг друга.
    const hisRequest = newRequest(BORIS, ANNA);
    assert.deepEqual(planRequest(ANNA, BORIS, hisRequest), { action: "accept" });
  });
});

describe("кто может принять", () => {
  const request = newRequest(ANNA, BORIS);

  it("тот, кого позвали", () => {
    assert.equal(canAccept(BORIS, request), true);
  });

  it("но не тот, кто звал", () => {
    assert.equal(
      canAccept(ANNA, request),
      false,
      "иначе можно было бы записаться в друзья к тому, кто тебя не звал",
    );
  });

  it("и не в уже принятой дружбе", () => {
    const accepted: Friendship = { ...request, status: "accepted" };
    assert.equal(canAccept(BORIS, accepted), false);
  });
});
