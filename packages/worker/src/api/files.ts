import { TokenSigner, newUserId } from "@badyum/core";
import {
  ATTACHMENT_MAX_BYTES,
  contentDisposition,
  isInlineImage,
  safeFileName,
  saneDimension,
  sniffImageType,
  type Attachment,
} from "@badyum/shared";
import { json } from "../http.ts";
import type { Env } from "../env.ts";

/** Сколько байт хватает, чтобы узнать формат по сигнатуре. */
const SNIFF_BYTES = 16;

/**
 * Загрузка вложения.
 *
 * Право даёт токен канала — тот же, которым открывают WebSocket. Это не
 * формальность: без него ручка складывала бы в наш бакет что угодно и кто
 * угодно, а платит за это владелец сервиса. Токен заодно говорит, в какой
 * канал класть, так что подделать чужой канал в запросе нельзя.
 */
export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "not_found" }, 404);
  if (!env.FILES) return json({ error: "files_disabled" }, 501);

  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const claims = await new TokenSigner(env.BADYUM_TOKEN_SECRET).verify(token);
  if (!claims) return json({ error: "bad_token" }, 401);

  /*
    Две проверки размера, и обе нужны. Заголовок отсекает лишнее до чтения тела —
    незачем тянуть через сеть то, что мы всё равно выбросим. Но заголовку верить
    нельзя: он может врать или отсутствовать вовсе при chunked-передаче, поэтому
    настоящая проверка — по факту прочитанного.
  */
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > ATTACHMENT_MAX_BYTES) return json({ error: "too_big" }, 413);

  const body = await request.arrayBuffer().catch(() => null);
  if (!body) return json({ error: "bad_input" }, 400);
  if (body.byteLength === 0) return json({ error: "empty" }, 400);
  if (body.byteLength > ATTACHMENT_MAX_BYTES) return json({ error: "too_big" }, 413);

  const name = safeFileName(url.searchParams.get("name") ?? "файл");

  /*
    Тип определяем по первым байтам, а присланный Content-Type игнорируем
    полностью. Это главная строчка во всём файле: назвать `image/png` можно и
    html со скриптом, а открытый с нашего домена он выполнится с правами нашей
    страницы и доберётся до куки сессии.
  */
  const sniffed = sniffImageType(new Uint8Array(body.slice(0, SNIFF_BYTES)));
  const kind = sniffed ? "image" : "file";
  const mime = sniffed ?? "application/octet-stream";

  const attachment: Attachment = {
    id: newUserId(),
    name,
    size: body.byteLength,
    kind,
    mime,
    ...maybeSize(url),
  };

  // Ключ включает канал: так видно, чьё это, и так удаляется всё разом, когда
  // канал уходит. Идентификатор случайный — по нему и находят файл.
  await env.FILES.put(`${claims.channelId}/${attachment.id}`, body, {
    httpMetadata: { contentType: mime },
    customMetadata: {
      name,
      kind,
      // Кто принёс. Пригодится, когда понадобится убрать чужое.
      userId: claims.userId,
    },
  });

  return json({ attachment });
}

/**
 * Отдача вложения.
 *
 * Токена здесь намеренно нет. Идентификатор случайный и неугадываемый — по той
 * же логике, по которой работает ссылка-приглашение: сама ссылка и есть ключ.
 * Иначе картинку нельзя было бы просто положить в `<img src>`, и пришлось бы
 * городить подписанные адреса ради того же уровня доступа.
 */
export async function handleFile(url: URL, env: Env): Promise<Response> {
  if (!env.FILES) return json({ error: "files_disabled" }, 501);

  // /api/file/<channelId>/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  const channelId = parts[2];
  const id = parts[3];
  if (!channelId || !id || parts.length !== 4) return json({ error: "not_found" }, 404);

  const object = await env.FILES.get(`${channelId}/${id}`);
  if (!object) return json({ error: "not_found" }, 404);

  const name = object.customMetadata?.name ?? "файл";
  const stored = object.httpMetadata?.contentType ?? "application/octet-stream";

  /*
    Тип пересчитываем по своему списку, а не берём из хранилища как есть.
    Записывали мы туда только опознанное, но правило «наружу уходит лишь то,
    что мы согласны показать» должно держаться и в том случае, если запись
    когда-нибудь сделает другой код.
  */
  const kind = isInlineImage(stored) ? "image" : "file";
  const type = kind === "image" ? stored : "application/octet-stream";

  return new Response(object.body, {
    headers: {
      "content-type": type,
      // Без этого браузер додумывает тип сам по содержимому и может решить,
      // что перед ним html. Тогда все проверки выше теряют смысл.
      "x-content-type-options": "nosniff",
      "content-disposition": contentDisposition(name, kind),
      // Файл неизменяем: его идентификатор случаен и второй раз не выдаётся.
      "cache-control": "public, max-age=31536000, immutable",
      "etag": object.httpEtag,
    },
  });
}

/** Размеры от клиента — только чтобы место под картинку было занято заранее. */
function maybeSize(url: URL): { width?: number; height?: number } {
  const width = saneDimension(Number(url.searchParams.get("w")));
  const height = saneDimension(Number(url.searchParams.get("h")));
  return width && height ? { width, height } : {};
}
