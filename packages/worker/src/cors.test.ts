import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowHeaders, forged, known, preflight, withCors } from "./cors.ts";

const SELF = "https://badyum.ru";

/** Запрос без возни с телом: проверяем только метод, origin и адрес. */
const ask = (method: string, origin: string | null): Request =>
  new Request(`${SELF}/api/channels`, {
    method,
    headers: origin ? { origin } : {},
  });

describe("свой ли origin", () => {
  it("узнаёт собственный сайт", () => {
    assert.equal(known(SELF, SELF), true);
  });

  it("узнаёт обёртку на всех трёх платформах", () => {
    for (const origin of ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
      assert.equal(known(origin, SELF), true, origin);
    }
  });

  it("не узнаёт чужой сайт", () => {
    assert.equal(known("https://evil.example", SELF), false);
  });

  it("не путается на похожем имени", () => {
    // Подстрока нашего адреса — но домен чужой, и пускать его нельзя.
    assert.equal(known("https://badyum.ru.evil.example", SELF), false);
    assert.equal(known("https://evil-tauri.localhost", SELF), false);
  });

  it("отсутствие origin — не свой", () => {
    assert.equal(known(null, SELF), false);
  });
});

describe("заголовки разрешения", () => {
  it("называет origin поимённо, а не звёздочкой", () => {
    // Со звёздочкой браузер отказывается слать куки, а сессия у нас на куке.
    const headers = allowHeaders("tauri://localhost");
    assert.equal(headers["access-control-allow-origin"], "tauri://localhost");
    assert.equal(headers["access-control-allow-credentials"], "true");
  });

  it("помечает ответ как зависящий от origin", () => {
    // Иначе общий кеш отдаст чужое разрешение вместе с ответом.
    assert.equal(allowHeaders(SELF).vary, "Origin");
  });
});

describe("предполётный запрос", () => {
  it("не трогает обычные запросы", () => {
    assert.equal(preflight(ask("POST", SELF), SELF), null);
  });

  it("разрешает своим", () => {
    const response = preflight(ask("OPTIONS", "tauri://localhost"), SELF);
    assert.equal(response?.status, 204);
    assert.equal(response?.headers.get("access-control-allow-origin"), "tauri://localhost");
  });

  it("отбивает чужих", () => {
    assert.equal(preflight(ask("OPTIONS", "https://evil.example"), SELF)?.status, 403);
  });
});

describe("подделка запроса с чужого сайта", () => {
  it("чтение не трогаем: читать ответ чужому всё равно нечем", () => {
    for (const method of ["GET", "HEAD"]) {
      assert.equal(forged(ask(method, "https://evil.example"), SELF), false, method);
    }
  });

  it("изменение с чужого origin — подделка", () => {
    for (const method of ["POST", "DELETE"]) {
      assert.equal(forged(ask(method, "https://evil.example"), SELF), true, method);
    }
  });

  it("изменение со своего сайта и из обёртки — не подделка", () => {
    assert.equal(forged(ask("POST", SELF), SELF), false);
    assert.equal(forged(ask("POST", "http://tauri.localhost"), SELF), false);
  });

  it("без origin пропускаем", () => {
    // Его не ставят curl и наши же тесты; браузер на межсайтовом ставит всегда.
    assert.equal(forged(ask("POST", null), SELF), false);
  });
});

describe("апгрейд до сокета", () => {
  const from = (origin: string) =>
    new Request("https://badyum.ru/presence", { headers: { origin } });

  /*
    Проверяем именно тождество объекта, а не заголовки.

    Пересобранный ответ выглядит правильно во всём, кроме одного: свойство
    webSocket в него не переносится, и соединение обрывается сразу после
    открытия. Снаружи это «связь пропала — переподключаюсь» по кругу, и ни один
    заголовок об этом не скажет.
  */
  it("отдаётся тем же объектом, а не пересобранным", () => {
    /*
      Ответ 101 приходится подделывать: ни node, ни рантайм Workers не дают
      сконструировать его без сокета — «status must be in the range of 200 to
      599». Это и есть вторая половина поломки: старый код такой ответ не просто
      обеднял, он падал на попытке его пересобрать.
    */
    const upgraded = { status: 101, headers: new Headers() } as unknown as Response;
    assert.equal(withCors(upgraded, from("http://tauri.localhost"), "https://badyum.ru"), upgraded);
  });

  it("узнаётся и по свойству webSocket, без опоры на статус", () => {
    // В рантайме Workers статус у апгрейда всегда 101, но полагаться на одно
    // это значит зависеть от того, чего в обычном Response нет вовсе.
    const upgraded = Object.assign(new Response(null), { webSocket: {} });
    assert.equal(withCors(upgraded, from("tauri://localhost"), "https://badyum.ru"), upgraded);
  });

  it("обычному ответу разрешение по-прежнему дописывается", () => {
    const plain = withCors(new Response("{}"), from("http://tauri.localhost"), "https://badyum.ru");
    assert.equal(plain.headers.get("access-control-allow-origin"), "http://tauri.localhost");
  });
});
