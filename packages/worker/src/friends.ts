import {
  canAccept,
  newRequest,
  otherOf,
  pairOf,
  planRequest,
  relationFor,
  type Friendship,
  type Relation,
  type RequestError,
} from "@badyum/core";
import type { User } from "./users.ts";

interface Row {
  user_a: string;
  user_b: string;
  requested_by: string;
  status: "pending" | "accepted";
  created_at: number;
}

const toLink = (row: Row): Friendship => ({
  userA: row.user_a,
  userB: row.user_b,
  requestedBy: row.requested_by,
  status: row.status,
  createdAt: row.created_at,
});

/** Контакт вместе с человеком: список показывают, а не считают. */
export interface Contact {
  user: Pick<User, "id" | "nick" | "tag" | "displayName" | "avatarUrl">;
  relation: Relation;
  since: number;
}

/**
 * Сколько заявок можно отправить за сутки.
 *
 * Не против человека: живой добавляет двоих-троих знакомых за вечер. Против
 * перебора — ник#тег угадывается, и без ограничения можно было бы разослать
 * заявку веером по всем тегам популярного ника.
 */
const REQUESTS_PER_DAY = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

export class Friends {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /** Связь между двоими, если она есть. */
  async between(x: string, y: string): Promise<Friendship | null> {
    const { userA, userB } = pairOf(x, y);
    const row = await this.db
      .prepare("SELECT * FROM friendships WHERE user_a = ? AND user_b = ?")
      .bind(userA, userB)
      .first<Row>();
    return row ? toLink(row) : null;
  }

  /**
   * Все контакты человека — друзья и незакрытые заявки в обе стороны.
   *
   * Одним запросом с JOIN, а не списком id и походом за каждым: контактов
   * бывает много, а лимит D1 считается в прочитанных строках.
   */
  async listFor(viewer: string): Promise<Contact[]> {
    const { results } = await this.db
      .prepare(
        `SELECT f.user_a, f.user_b, f.requested_by, f.status, f.created_at,
                u.id, u.nick, u.tag, u.display_name, u.avatar_url
           FROM friendships f
           JOIN users u
             ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
          WHERE f.user_a = ?1 OR f.user_b = ?1
          ORDER BY f.created_at DESC`,
      )
      .bind(viewer)
      .all<Row & { id: string; nick: string; tag: string; display_name: string; avatar_url: string | null }>();

    return results.map((row) => {
      const link = toLink(row);
      return {
        user: {
          id: row.id,
          nick: row.nick,
          tag: row.tag,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
        },
        relation: relationFor(viewer, otherOf(link, viewer), link),
        since: row.created_at,
      };
    });
  }

  /** Только принявшие — кому можно звонить и чей статус нам интересен. */
  async idsOfFriends(viewer: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT CASE WHEN user_a = ?1 THEN user_b ELSE user_a END AS other
           FROM friendships
          WHERE (user_a = ?1 OR user_b = ?1) AND status = 'accepted'`,
      )
      .bind(viewer)
      .all<{ other: string }>();
    return results.map((r) => r.other);
  }

  /**
   * Отправить заявку.
   *
   * Решение принимает ядро (`planRequest`), здесь только запись. Отдельно стоит
   * заметить `action: "accept"`: встречная заявка не создаёт вторую строку, а
   * означает согласие — двое, добавившие друг друга одновременно, становятся
   * друзьями, а не зависают каждый со своей исходящей.
   */
  async request(
    from: string,
    to: string,
  ): Promise<{ ok: true; relation: Relation } | { ok: false; error: RequestError | "too_many" }> {
    const existing = await this.between(from, to);
    const plan = planRequest(from, to, existing);
    if ("error" in plan) return { ok: false, error: plan.error };

    if (plan.action === "accept") {
      // Принимает `from`: это он сейчас позвал в ответ на чужую заявку.
      // Порядок здесь легко перепутать, и тогда встречная заявка тихо ничего
      // не делает — оба остаются висеть с «отправлено».
      if (await this.accept(from, to)) return { ok: true, relation: "friends" };

      // Не приняли — между чтением и записью что-то изменилось. Отвечаем тем,
      // что есть на самом деле, а не тем, что собирались сделать.
      return { ok: true, relation: relationFor(from, to, await this.between(from, to)) };
    }

    if (!(await this.underDailyLimit(from))) return { ok: false, error: "too_many" };

    const link = newRequest(from, to);
    await this.db
      .prepare(
        `INSERT INTO friendships (user_a, user_b, requested_by, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`,
      )
      .bind(link.userA, link.userB, link.requestedBy, link.createdAt)
      .run();

    return { ok: true, relation: "outgoing" };
  }

  /** Принять входящую. Принимает только тот, кого позвали. */
  async accept(viewer: string, other: string): Promise<boolean> {
    const link = await this.between(viewer, other);
    if (!link || !canAccept(viewer, link)) return false;

    await this.db
      .prepare(
        "UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?",
      )
      .bind(link.userA, link.userB)
      .run();
    return true;
  }

  /**
   * Отклонить входящую, отменить свою, удалить из друзей.
   *
   * Все три — одно и то же: строки больше нет. Разделять их незачем, а отказ
   * именно удаляет, а не помечает: он значит «не сейчас», и позвать снова
   * человек должен мочь.
   */
  async remove(viewer: string, other: string): Promise<boolean> {
    const { userA, userB } = pairOf(viewer, other);
    const result = await this.db
      .prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?")
      .bind(userA, userB)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  private async underDailyLimit(from: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM friendships
          WHERE requested_by = ? AND created_at > ?`,
      )
      .bind(from, Date.now() - DAY_MS)
      .first<{ n: number }>();
    return (row?.n ?? 0) < REQUESTS_PER_DAY;
  }
}
