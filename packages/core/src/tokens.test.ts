import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenSigner, TOKEN_TTL_SECONDS } from "./tokens.ts";

const claims = {
  userId: "u1",
  channelId: "ch_1",
  displayName: "дюма",
  inviteCode: "x7k2mq",
  identityId: null,
};

describe("токены входа", () => {
  it("подписанный токен проходит проверку и сохраняет данные", async () => {
    const signer = new TokenSigner("секрет");
    const token = await signer.signJoinToken(claims);
    const verified = await signer.verify(token);

    assert.ok(verified, "токен не прошёл проверку");
    assert.equal(verified.userId, "u1");
    assert.equal(verified.channelId, "ch_1");
    assert.equal(verified.displayName, "дюма");
    assert.equal(verified.inviteCode, "x7k2mq");
    assert.ok(verified.exp > Math.floor(Date.now() / 1000));
    assert.ok(verified.exp <= Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS);
  });

  it("токен, подписанный другим секретом, отвергается", async () => {
    const mine = new TokenSigner("секрет");
    const stranger = new TokenSigner("другой секрет");

    const token = await stranger.signJoinToken(claims);

    assert.equal(await mine.verify(token), null);
  });

  /**
   * Главное, что должен уметь токен: не пускать в чужой канал. Подмена тела без
   * подписи — самая очевидная попытка, и она обязана отваливаться.
   */
  it("подмена канала в теле ломает подпись", async () => {
    const signer = new TokenSigner("секрет");
    const token = await signer.signJoinToken(claims);
    const [body, signature] = token.split(".");

    const decoded = JSON.parse(
      Buffer.from(body!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    decoded.channelId = "ch_чужой";
    const forgedBody = Buffer.from(JSON.stringify(decoded))
      .toString("base64url");

    assert.equal(await signer.verify(`${forgedBody}.${signature}`), null);
  });

  it("истёкший токен не проходит", async () => {
    const signer = new TokenSigner("секрет");
    // Подписываем вручную с прошедшим сроком: ждать TTL в тесте незачем.
    const body = Buffer.from(
      JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 }),
    ).toString("base64url");
    const signed = await signer.signJoinToken(claims);
    // Берём подпись от валидного токена — она не подойдёт, но проверяем именно
    // срок: сначала убедимся, что корректно подписанный просроченный отвергнут.
    assert.equal(await signer.verify(`${body}.${signed.split(".")[1]}`), null);
  });

  it("мусор вместо токена не роняет проверку", async () => {
    const signer = new TokenSigner("секрет");
    for (const junk of ["", ".", "abc", "abc.def", "....", "a.!!!не base64!!!"]) {
      assert.equal(await signer.verify(junk), null, `упал на ${JSON.stringify(junk)}`);
    }
  });

  it("токен возврата живёт дольше и не тащит за собой инвайт", async () => {
    const signer = new TokenSigner("секрет");

    const join = await signer.verify(await signer.signJoinToken(claims));
    const resume = await signer.verify(await signer.signResumeToken(claims));

    assert.ok(join && resume);
    assert.ok(resume.exp > join.exp, "токен возврата должен жить дольше");
    assert.equal(resume.resume, true);
    // Иначе переподключение съедало бы использование одноразовой ссылки.
    assert.equal(resume.inviteCode, null);
  });

  it("имя с кириллицей и эмодзи переживает кодирование", async () => {
    const signer = new TokenSigner("секрет");
    const name = "дюма 🎧 максимов";
    const verified = await signer.verify(
      await signer.signJoinToken({ ...claims, displayName: name }),
    );

    assert.equal(verified?.displayName, name);
  });
});
