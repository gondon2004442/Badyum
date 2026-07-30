import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { CloudflareTurn, normalizeCloudflareServers } from "./turn.ts";

const CF_REPLY = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "user",
      credential: "secret",
    },
  ],
};

/** Заглушка их API: считает вызовы и умеет ломаться. */
function fakeFetch(reply: unknown, opts: { status?: number; throws?: boolean } = {}) {
  const calls: unknown[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(init.body);
    if (opts.throws) throw new Error("сеть отвалилась");
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      json: async () => reply,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("разбор ответа Cloudflare TURN", () => {
  it("выбрасывает адреса на 53 порту, которые браузер всё равно заблокирует", () => {
    const servers = normalizeCloudflareServers(CF_REPLY);

    const urls = servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    assert.ok(!urls.some((u) => u.includes(":53")), `остался 53: ${urls.join(", ")}`);
    assert.ok(urls.includes("turns:turn.cloudflare.com:443?transport=tcp"));
  });

  it("сохраняет креды у relay-записи", () => {
    const servers = normalizeCloudflareServers(CF_REPLY);
    const relay = servers.find((s) => s.username);

    assert.equal(relay?.username, "user");
    assert.equal(relay?.credential, "secret");
  });

  it("принимает и одиночный объект вместо массива", () => {
    const servers = normalizeCloudflareServers({
      iceServers: { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "u", credential: "c" },
    });

    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.username, "u");
  });

  it("не пропускает запись, от которой после фильтра не осталось адресов", () => {
    const servers = normalizeCloudflareServers({
      iceServers: [{ urls: ["stun:stun.cloudflare.com:53"] }],
    });

    assert.deepEqual(servers, []);
  });
});

describe("кэш кред Cloudflare TURN", () => {
  it("до первого обновления не отдаёт ничего", () => {
    const turn = new CloudflareTurn({ keyId: "k", apiToken: "t", fetchImpl: fakeFetch(CF_REPLY).impl });

    assert.equal(turn.isFresh(), false);
    assert.deepEqual(turn.servers(), []);
  });

  it("после обновления отдаёт креды и просит у API заданный ttl", async () => {
    const { impl, calls } = fakeFetch(CF_REPLY);
    const turn = new CloudflareTurn({ keyId: "k", apiToken: "t", fetchImpl: impl, ttlSeconds: 3600 });

    assert.equal(await turn.refresh(), true);
    assert.equal(turn.isFresh(), true);
    assert.ok(turn.servers().some((s) => s.username === "user"));
    assert.deepEqual(JSON.parse(String(calls[0])), { ttl: 3600 });
  });

  it("схлопывает одновременные обновления в один запрос", async () => {
    const { impl, calls } = fakeFetch(CF_REPLY);
    const turn = new CloudflareTurn({ keyId: "k", apiToken: "t", fetchImpl: impl });

    await Promise.all([turn.refresh(), turn.refresh(), turn.refresh()]);

    assert.equal(calls.length, 1);
  });

  it("не отдаёт креды, которым осталось меньше запаса на разговор", async () => {
    let now = 1_000_000;
    const { impl } = fakeFetch(CF_REPLY);
    const turn = new CloudflareTurn({
      keyId: "k",
      apiToken: "t",
      fetchImpl: impl,
      now: () => now,
      ttlSeconds: 3600,
      minRemainingSeconds: 1800,
    });

    await turn.refresh();
    assert.equal(turn.isFresh(), true);

    // Прошло больше половины срока — остатка уже не хватит на длинный разговор.
    now += 1801 * 1000;
    assert.equal(turn.isFresh(), false);
    assert.deepEqual(turn.servers(), []);
  });

  it("при ошибке сети сохраняет прежние креды, чтобы не рвать текущие разговоры", async () => {
    // Первый запрос удаётся, все следующие падают.
    let attempt = 0;
    const impl = (async () => {
      attempt += 1;
      if (attempt > 1) throw new Error("сеть отвалилась");
      return { ok: true, status: 200, json: async () => CF_REPLY };
    }) as unknown as typeof fetch;

    const turn = new CloudflareTurn({
      keyId: "k",
      apiToken: "t",
      fetchImpl: impl,
      ttlSeconds: 3600,
      minRemainingSeconds: 60,
    });

    assert.equal(await turn.refresh(), true);
    assert.equal(await turn.refresh(), false);

    assert.equal(turn.isFresh(), true);
    assert.ok(turn.servers().some((s) => s.username === "user"));
  });

  /**
   * Здесь настоящий HTTP и настоящий fetch, а не подделка: путь запроса и
   * заголовок авторизации подделка не проверяет, а перепутать их — ровно тот
   * случай, когда relay не работает при верных ключах.
   */
  it("шлёт POST по документированному пути с Bearer-токеном", async () => {
    const seen: { url?: string; auth?: string; body?: string; method?: string } = {};
    const stub = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.method = req.method;
        seen.url = req.url;
        seen.auth = req.headers.authorization;
        seen.body = Buffer.concat(chunks).toString();
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify(CF_REPLY));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const port = (stub.address() as { port: number }).port;

    try {
      const turn = new CloudflareTurn({
        keyId: "key/with/slashes",
        apiToken: "tok3n",
        endpoint: `http://127.0.0.1:${port}/v1/turn/keys`,
        ttlSeconds: 7200,
      });

      assert.equal(await turn.refresh(), true);
      assert.equal(seen.method, "POST");
      assert.equal(
        seen.url,
        "/v1/turn/keys/key%2Fwith%2Fslashes/credentials/generate-ice-servers",
      );
      assert.equal(seen.auth, "Bearer tok3n");
      assert.deepEqual(JSON.parse(String(seen.body)), { ttl: 7200 });
      assert.ok(turn.servers().some((s) => s.credential === "secret"));
    } finally {
      stub.close();
    }
  });

  it("считает ответ с ошибкой неудачей и сообщает о ней", async () => {
    const messages: string[] = [];
    const turn = new CloudflareTurn({
      keyId: "k",
      apiToken: "t",
      fetchImpl: fakeFetch(CF_REPLY, { status: 401 }).impl,
      onError: (m) => messages.push(m),
    });

    assert.equal(await turn.refresh(), false);
    assert.equal(turn.isFresh(), false);
    assert.ok(messages[0]?.includes("401"), messages.join(" / "));
  });
});
