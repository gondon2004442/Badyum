import { newUserId } from "@badyum/core";
import { isInlineImage, sniffImageType } from "@badyum/shared";
import { Users, type User } from "../users.ts";
import { json } from "../http.ts";
import type { Env } from "../env.ts";

/**
 * Потолок для аватарки.
 *
 * Полмегабайта — это очень много для картинки 256×256: клиент присылает уже
 * обрезанную и сжатую, и она весит десятки килобайт. Потолок здесь не для
 * честного человека, а против того, кто пошлёт десять мегабайт напрямую в
 * ручку, минуя наш интерфейс.
 */
const MAX_BYTES = 512 * 1024;

/** Хватает, чтобы узнать формат по сигнатуре. */
const SNIFF_BYTES = 16;

const KEY_PREFIX = "avatars/";

/** Где лежит аватарка по её идентификатору. Путь хранится в базе как есть. */
const pathOf = (id: string): string => `/api/avatar/${id}`;
const idOf = (path: string): string | null => {
  const match = /^\/api\/avatar\/([A-Za-z0-9_-]+)$/.exec(path);
  return match?.[1] ?? null;
};

/**
 * Поставить или снять свою аватарку.
 *
 * Вход обязателен: аватарка принадлежит аккаунту, а у гостя его нет. Картинку
 * присылают уже обрезанной в квадрат и сжатой — обрезка живёт на клиенте,
 * потому что там есть canvas, а в Worker'е пришлось бы тянуть кодек.
 */
export async function handleAvatar(
  request: Request,
  env: Env,
  viewer: User,
): Promise<Response> {
  if (!env.FILES) return json({ error: "files_disabled" }, 501);

  const users = new Users(env.DB);

  if (request.method === "DELETE") {
    const previous = await users.setAvatar(viewer.id, null);
    await dropOld(env, previous);
    // null означает «вернулись к тому, что даёт Google, или к инициалам».
    return json({ avatarUrl: (await users.byId(viewer.id))?.avatarUrl ?? null });
  }

  if (request.method !== "POST") return json({ error: "not_found" }, 404);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return json({ error: "too_big" }, 413);

  const body = await request.arrayBuffer().catch(() => null);
  if (!body || body.byteLength === 0) return json({ error: "bad_input" }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: "too_big" }, 413);

  /*
    Тип определяем по сигнатуре, присланный Content-Type не смотрим вовсе — та
    же причина, что и у вложений: под видом картинки легко прислать html, а он,
    открытый с нашего домена, выполнится с правами нашей страницы.
  */
  const mime = sniffImageType(new Uint8Array(body.slice(0, SNIFF_BYTES)));
  if (!mime) return json({ error: "not_an_image" }, 400);

  const id = newUserId();
  await env.FILES.put(KEY_PREFIX + id, body, {
    httpMetadata: { contentType: mime },
    customMetadata: { userId: viewer.id },
  });

  // Прежнюю убираем только после того, как новая легла: обратный порядок при
  // неудаче оставил бы человека вообще без картинки.
  const previous = await users.setAvatar(viewer.id, pathOf(id));
  await dropOld(env, previous);

  return json({ avatarUrl: pathOf(id) });
}

/**
 * Отдача аватарки.
 *
 * Без токена: аватарку видят все, кому виден сам человек, и подписывать адрес
 * ради этого незачем. Идентификатор случайный и при каждой замене новый —
 * поэтому ответ можно кэшировать навсегда, а смена картинки видна сразу, без
 * возни с инвалидацией.
 */
export async function handleAvatarFile(url: URL, env: Env): Promise<Response> {
  if (!env.FILES) return json({ error: "files_disabled" }, 501);

  const id = idOf(url.pathname);
  if (!id) return json({ error: "not_found" }, 404);

  const object = await env.FILES.get(KEY_PREFIX + id);
  if (!object) return json({ error: "not_found" }, 404);

  const stored = object.httpMetadata?.contentType ?? "";
  // Ещё одна проверка на отдаче: наружу уходит только то, что мы согласны
  // показать картинкой, даже если в хранилище когда-то попадёт что-то иное.
  if (!isInlineImage(stored)) return json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: {
      "content-type": stored,
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=31536000, immutable",
      etag: object.httpEtag,
    },
  });
}

/** Убрать из хранилища картинку, которую заменили. Иначе бакет копит мусор. */
async function dropOld(env: Env, previous: string | null): Promise<void> {
  if (!previous || !env.FILES) return;
  const id = idOf(previous);
  if (!id) return;
  await env.FILES.delete(KEY_PREFIX + id).catch(() => undefined);
}
