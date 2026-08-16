import { generateTag, newUserId, nickFromName, usernameKey } from "@badyum/core";

export interface User {
  id: string;
  /**
   * Юз, по которому человека находят. `null` — ещё не выбрал.
   *
   * Так у всех, кто завёл аккаунт до того, как юзы появились: их кириллические
   * ники в новые правила не переводятся, а придумывать за человека то, по чему
   * его будут звать, — не наше дело.
   */
  username: string | null;
  /** Ник и тег — прошлый способ адресации. Оставлены до чистки схемы. */
  nick: string;
  tag: string;
  displayName: string;
  avatarUrl: string | null;
  /**
   * Своя аватарка отдельно от вычисленной. Нужна ровно затем, чтобы при замене
   * знать, какой объект в хранилище больше не нужен.
   */
  avatarOwn: string | null;
  createdAt: number;
}

interface Row {
  id: string;
  username: string | null;
  nick: string;
  tag: string;
  display_name: string;
  avatar_url: string | null;
  avatar_own: string | null;
  created_at: number;
}

const toUser = (row: Row): User => ({
  id: row.id,
  username: row.username,
  nick: row.nick,
  tag: row.tag,
  displayName: row.display_name,
  /*
    Своя картинка важнее гугловой. Google обновляет avatar_url при каждом
    входе, поэтому «своё» и «пришедшее из профиля» обязаны жить раздельно —
    иначе выбор человека сбрасывался бы сам собой.
  */
  avatarUrl: row.avatar_own ?? row.avatar_url,
  avatarOwn: row.avatar_own,
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

  /**
   * Поиск «кто такой dumax».
   *
   * По нижнему регистру: человек, которому продиктовали юз, наберёт его как
   * услышал, и «Dumax» должен находиться по «dumax».
   */
  async byUsername(username: string): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE lower(username) = ?")
      .bind(usernameKey(username))
      .first<Row>();
    return row ? toUser(row) : null;
  }

  /**
   * Занять юз.
   *
   * Проверять «свободен ли» отдельным запросом и потом писать — гонка: между
   * проверкой и записью его успевает занять другой. Поэтому пишем сразу и
   * полагаемся на уникальный индекс, а «занято» узнаём из его отказа.
   */
  /**
   * Поставить свою аватарку.
   *
   * Возвращает прежнюю, чтобы вызывающий мог удалить её из хранилища: иначе
   * каждая смена картинки оставляла бы в бакете мусор навсегда.
   */
  async setAvatar(userId: string, path: string | null): Promise<string | null> {
    const before = await this.byId(userId);

    await this.db
      .prepare("UPDATE users SET avatar_own = ? WHERE id = ?")
      .bind(path, userId)
      .run();

    return before?.avatarOwn ?? null;
  }

  async setUsername(
    id: string,
    username: string,
  ): Promise<{ ok: true; user: User } | { ok: false; error: "taken" | "not_found" }> {
    try {
      await this.db
        .prepare("UPDATE users SET username = ? WHERE id = ?")
        .bind(username, id)
        .run();
    } catch {
      // Разбирать текст ошибки D1 не станем: он не часть контракта и меняется
      // между версиями. Нарушить здесь можно ровно одно ограничение.
      return { ok: false, error: "taken" };
    }

    const user = await this.byId(id);
    return user ? { ok: true, user } : { ok: false, error: "not_found" };
  }

  /** Поиск «кто такой дюма#4821» — прошлый способ, до чистки схемы. */
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
      return {
        ...existing,
        displayName: profile.name,
        // Гугловую картинку обновили в базе, но показываем по-прежнему свою,
        // если она есть: иначе вход через Google сбрасывал бы выбор человека
        // ровно до следующей перезагрузки страницы, и это выглядело бы как
        // «аватарка не сохранилась».
        avatarUrl: existing.avatarOwn ?? profile.picture,
      };
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
          // Юз человек выберет сам при первом входе: подставлять за него то,
          // по чему его будут звать, — не наше дело.
          username: null,
          nick,
          tag,
          displayName: profile.name,
          avatarUrl: profile.picture,
          // Только что заведённый аккаунт своей картинки ещё не имеет.
          avatarOwn: null,
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
