import { generateTag, newUserId, nickFromName } from "@badyum/core";

export interface User {
  id: string;
  nick: string;
  tag: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: number;
}

interface Row {
  id: string;
  nick: string;
  tag: string;
  display_name: string;
  avatar_url: string | null;
  created_at: number;
}

const toUser = (row: Row): User => ({
  id: row.id,
  nick: row.nick,
  tag: row.tag,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  createdAt: row.created_at,
});

/**
 * Сколько раз пробуем подобрать свободный тег к нику.
 *
 * Тегов на ник десять тысяч. Коллизия при первых пользователях невероятна, но
 * популярный ник рано или поздно заполнится, и молчаливый отказ на входе — не
 * то, что человек должен увидеть после успешной авторизации у Google.
 */
const TAG_ATTEMPTS = 12;

export class Users {
  constructor(private readonly db: D1Database) {}

  async byId(id: string): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(id)
      .first<Row>();
    return row ? toUser(row) : null;
  }

  async byGoogleSub(sub: string): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE google_sub = ?")
      .bind(sub)
      .first<Row>();
    return row ? toUser(row) : null;
  }

  /** Поиск «кто такой дюма#4821». */
  async byNick(nick: string, tag: string): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE nick = ? AND tag = ?")
      .bind(nick, tag)
      .first<Row>();
    return row ? toUser(row) : null;
  }

  /**
   * Вход через Google: находим или заводим.
   *
   * Ищем по `sub`, а не по почте: почту человек может сменить, и тогда он
   * потерял бы свой аккаунт вместе с друзьями и историей.
   *
   * Существующему пользователю обновляем только аватар и отображаемое имя —
   * ник и тег принадлежат ему, а не Google, и меняться за его спиной не должны.
   */
  async upsertFromGoogle(profile: {
    sub: string;
    name: string;
    picture: string | null;
  }): Promise<User> {
    const existing = await this.byGoogleSub(profile.sub);
    if (existing) {
      await this.db
        .prepare("UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?")
        .bind(profile.name, profile.picture, existing.id)
        .run();
      return { ...existing, displayName: profile.name, avatarUrl: profile.picture };
    }

    const nick = nickFromName(profile.name);
    const id = newUserId();
    const createdAt = Date.now();

    for (let attempt = 0; attempt < TAG_ATTEMPTS; attempt += 1) {
      const tag = generateTag();
      try {
        await this.db
          .prepare(
            `INSERT INTO users (id, nick, tag, display_name, avatar_url, google_sub, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, nick, tag, profile.name, profile.picture, profile.sub, createdAt)
          .run();

        return {
          id,
          nick,
          tag,
          displayName: profile.name,
          avatarUrl: profile.picture,
          createdAt,
        };
      } catch (err) {
        // Гонка: тот же sub успел вставить параллельный запрос (человек нажал
        // «войти» дважды). Тогда это не занятый тег, а уже готовый пользователь.
        const raced = await this.byGoogleSub(profile.sub);
        if (raced) return raced;

        // Иначе занят тег — пробуем следующий. Разбирать текст ошибки D1 не
        // станем: он не часть контракта и меняется между версиями.
        if (attempt === TAG_ATTEMPTS - 1) throw err;
      }
    }

    throw new Error("не удалось подобрать тег");
  }

  /** Сменить ник, сохранив тег, если пара свободна. */
  async rename(id: string, nick: string): Promise<User | null> {
    const user = await this.byId(id);
    if (!user) return null;

    try {
      await this.db
        .prepare("UPDATE users SET nick = ? WHERE id = ?")
        .bind(nick, id)
        .run();
      return { ...user, nick };
    } catch {
      // Пара ник+тег занята. Тег менять молча нельзя — человек его знает и мог
      // кому-то продиктовать.
      return null;
    }
  }
}
