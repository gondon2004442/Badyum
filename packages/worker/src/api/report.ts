import { z } from "zod";
import { newUserId } from "@badyum/core";
import { signatureOf, trimMessage, trimStack } from "@badyum/shared";
import { json } from "../http.ts";
import type { Env } from "../env.ts";
import type { Registry } from "../Registry.ts";

/**
 * Тело больше этого — не ошибка, а попытка засорить журнал. Стек мы и так
 * режем на клиенте до шести кадров, так что честному сообщению хватает с
 * запасом.
 */
const BODY_LIMIT = 8 * 1024;

/** Сколько журнал хранит. Дальше запись уже ничего не объясняет. */
const KEEP_DAYS = 30;
/**
 * Как часто подчищаем. Не по расписанию, а изредка на живом запросе: cron ради
 * таблицы, куда пишут несколько раз в день, — это лишняя движущаяся часть.
 */
const PRUNE_CHANCE = 0.05;

const bodySchema = z.object({
  kind: z.string().min(1).max(40),
  message: z.string().min(1).max(2000),
  stack: z.string().max(4000).optional(),
  /** Экран, с которого пришло. Код инвайта клиент вырезает сам. */
  page: z.string().max(200).optional(),
  /** Хэш бандла: без него не отличить «уже починили» от «не чинили». */
  build: z.string().max(60).optional(),
});

/**
 * Приём сообщений о клиентских поломках.
 *
 * Зачем вообще: все настоящие ошибки этого проекта нашлись не типами и не
 * тестами, а тем, что кто-то открыл два браузера и попробовал. С телефона в
 * чужой сети такого браузера у нас нет — «у меня не работает» приходится
 * разгадывать. Эта ручка и есть замена ему.
 *
 * Вход намеренно не требуется: самые интересные поломки случаются как раз до
 * него — на экране входа по ссылке, у гостя, у того, кто вообще не завёл
 * аккаунт.
 */
export async function handleReport(
  request: Request,
  env: Env,
  registry: DurableObjectStub<Registry>,
  userId: string | null,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "not_found" }, 404);

  // Адрес ставит сам Cloudflare, подделать его клиент не может. Пустая строка
  // — общее ведро: один общий лимит лучше, чем ни одного.
  const from = request.headers.get("cf-connecting-ip") ?? "";
  if (!(await registry.allowReport(from))) {
    // 429, а не тихое «ок»: клиент по этому ответу замолкает до перезагрузки,
    // и лишних запросов больше не делает.
    return json({ error: "too_many" }, 429);
  }

  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_LIMIT) return json({ error: "too_big" }, 413);

  const parsed = bodySchema.safeParse(safeJson(raw));
  if (!parsed.success) return json({ error: "bad_input" }, 400);

  const message = trimMessage(parsed.data.message);
  const stack = trimStack(parsed.data.stack);

  await env.DB.prepare(
    `INSERT INTO client_errors
       (id, at, user_id, kind, message, stack, page, agent, build, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newUserId(),
      Date.now(),
      userId,
      parsed.data.kind,
      message,
      stack ?? null,
      parsed.data.page ?? null,
      // Из заголовка, а не из тела: он и так есть, и телом его не подменить.
      (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
      parsed.data.build ?? null,
      // Отпечаток считаем сами. Присланному верить нельзя: сломанная или
      // подделанная группировка превращает журнал в кашу ровно тогда, когда он
      // нужнее всего.
      signatureOf({ kind: parsed.data.kind, message, stack }),
    )
    .run();

  if (Math.random() < PRUNE_CHANCE) {
    await env.DB.prepare("DELETE FROM client_errors WHERE at < ?")
      .bind(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)
      .run()
      // Уборка не обязана удаться: сообщение уже записано, а это главное.
      .catch(() => undefined);
  }

  return json({ ok: true });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
