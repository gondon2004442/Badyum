import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowHeaders, forged, known, preflight } from "./cors.ts";

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
