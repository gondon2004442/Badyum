import { z } from "zod";
import { normalizeUsername, relationFor } from "@badyum/core";
import { Friends } from "../friends.ts";
import { Users, type User } from "../users.ts";
import { json } from "../http.ts";
import type { Env } from "../env.ts";

/** Что о человеке видно другому. Ни google_sub, ни даты — только личность. */
const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  nick: u.nick,
  tag: u.tag,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
});

const handleSchema = z.object({ handle: z.string().min(1).max(80) });

/**
 * Как объяснить человеку, почему юз не подошёл.
 *
 * Словами, а не кодом: «юз не подходит» читается как «сервис сломался», а
 * «можно только латиницу, цифры, точку и подчёркивание» — как понятное правило,
 * по которому можно исправиться с первого раза.
 */
const WHY: Record<string, string> = {
  too_short: "Слишком короткий — нужно хотя бы три символа",
  too_long: "Слишком длинный — не больше двадцати символов",
  bad_chars: "Можно латиницу, цифры, точку и подчёркивание",
  bad_edges: "Не может начинаться или заканчиваться точкой или подчёркиванием",
  double_separator: "Две точки или подчёркивания подряд — нельзя",
  reserved: "Это слово занято сервисом",
  taken: "Этот юз уже занят",
};

/**
 * Контакты.
 *
 * Возвращает `null`, если путь не наш — тогда общий маршрутизатор идёт дальше.
 * Все ручки требуют входа: контакты есть только у того, у кого есть аккаунт.
 */
export async function handleContacts(
  request: Request,
  url: URL,
  env: Env,
  viewer: User,
): Promise<Response | null> {
  const friends = new Friends(env.DB);
  const users = new Users(env.DB);
  const path = url.pathname;

  /** Кто такой «dumax» и кем он мне приходится. */
  if (path === "/api/contacts/lookup") {
    const parsed = normalizeUsername(url.searchParams.get("handle") ?? "");
    if (!parsed.ok) return json({ error: "bad_handle", why: WHY[parsed.problem] }, 400);

    const found = await users.byUsername(parsed.username);
    if (!found) return json({ error: "not_found" }, 404);

    const link = await friends.between(viewer.id, found.id);
    return json({
      user: publicUser(found),
      relation: relationFor(viewer.id, found.id, link),
    });
  }

  if (path === "/api/contacts" && request.method === "GET") {
    return json({ contacts: await friends.listFor(viewer.id) });
  }

  /** Позвать в друзья по нику#тегу. */
  if (path === "/api/contacts" && request.method === "POST") {
    const body = handleSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "bad_input" }, 400);

    const parsed = normalizeUsername(body.data.handle);
    if (!parsed.ok) return json({ error: "bad_handle", why: WHY[parsed.problem] }, 400);

    const target = await users.byUsername(parsed.username);
    if (!target) return json({ error: "not_found" }, 404);

    const result = await friends.request(viewer.id, target.id);
    if (!result.ok) {
      // «Уже друзья» и «уже отправлена» — не ошибки сервера, а состояние,
      // которое человек и так видит на экране. 409, чтобы клиент мог показать
      // это словами, а не «что-то пошло не так».
      return json({ error: result.error }, result.error === "too_many" ? 429 : 409);
    }

    return json({ user: publicUser(target), relation: result.relation });
  }

  /**
   * Переписка с контактом.
   *
   * Отдаёт постоянный личный канал пары — тот же самый, в который придёт и
   * звонок. Заводится он здесь же при первом обращении: держать пустой канал
   * для каждой пары, которая, может, никогда и не заговорит, незачем.
   */
  const chat = /^\/api\/contacts\/([^/]+)\/chat$/.exec(path);
  if (chat) {
    const other = decodeURIComponent(chat[1]!);

    // Переписка — для друзей. Иначе достаточно было бы узнать чужой
    // идентификатор, чтобы написать кому угодно.
    const link = await friends.between(viewer.id, other);
    if (link?.status !== "accepted") return json({ error: "not_friends" }, 403);

    const peer = await users.byId(other);
    if (!peer) return json({ error: "not_found" }, 404);

    const registry = env.REGISTRY.get(env.REGISTRY.idFromName("global"));
    const { channel, invite } = await registry.directChannel(
      viewer.id,
      other,
      `${viewer.displayName} и ${peer.displayName}`,
    );

    return json({ channelId: channel.id, code: invite.code, peer: publicUser(peer) });
  }

  const accept = /^\/api\/contacts\/([^/]+)\/accept$/.exec(path);
  if (accept && request.method === "POST") {
    const ok = await friends.accept(viewer.id, decodeURIComponent(accept[1]!));
    return ok ? json({ relation: "friends" }) : json({ error: "not_found" }, 404);
  }

  const remove = /^\/api\/contacts\/([^/]+)$/.exec(path);
  if (remove && request.method === "DELETE") {
    // Отклонить входящую, отменить свою, удалить из друзей — одно и то же
    // действие: строки больше нет. Разные слова в интерфейсе, один маршрут.
    const ok = await friends.remove(viewer.id, decodeURIComponent(remove[1]!));
    return ok ? json({ relation: "none" }) : json({ error: "not_found" }, 404);
  }

  return null;
}
