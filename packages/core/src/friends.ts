/**
 * Дружба: заявка, принятие, отказ.
 *
 * Логика вынесена отдельно от базы, потому что она не про SQL, а про людей, и
 * ошибиться в ней легко. Главная тонкость: строка в базе одна на пару, а
 * смотрят на неё двое с разных сторон — для одного заявка исходящая, для
 * другого та же самая входящая.
 */

export type FriendStatus = "pending" | "accepted";

export interface Friendship {
  /** Меньший id пары. См. `pairOf`. */
  userA: string;
  /** Больший id пары. */
  userB: string;
  /** Кто позвал. Без этого входящую заявку не отличить от исходящей. */
  requestedBy: string;
  status: FriendStatus;
  createdAt: number;
}

/**
 * Чем один человек приходится другому — с точки зрения смотрящего.
 *
 * `self` существует не для красоты: без него «добавить себя в друзья» стало бы
 * обычной заявкой, которую некому принять.
 */
export type Relation = "self" | "none" | "friends" | "outgoing" | "incoming";

/**
 * Пара в каноническом порядке.
 *
 * Порядок фиксирован, чтобы дружба хранилась одной строкой, а не двумя. Иначе
 * на вопрос «а мы уже друзья?» пришлось бы искать в двух направлениях, и рано
 * или поздно нашлась бы половина ответа: заявка есть у него, а у тебя нет.
 */
export function pairOf(x: string, y: string): { userA: string; userB: string } {
  return x < y ? { userA: x, userB: y } : { userA: y, userB: x };
}

/** Как выглядит связь для того, кто смотрит. */
export function relationFor(viewer: string, other: string, link: Friendship | null): Relation {
  if (viewer === other) return "self";
  if (!link) return "none";
  if (link.status === "accepted") return "friends";
  return link.requestedBy === viewer ? "outgoing" : "incoming";
}

/** Второй участник пары. */
export function otherOf(link: Friendship, viewer: string): string {
  return link.userA === viewer ? link.userB : link.userA;
}

export type RequestError = "self" | "already_friends" | "already_sent";

/**
 * Что делать с заявкой от `from` к `to` при текущем состоянии связи.
 *
 * Отдельный шаг, а не проверка внутри записи в базу: правил здесь четыре, и
 * одно из них неочевидное — встречная заявка не создаёт вторую строку, а
 * означает согласие. Двое, добавившие друг друга одновременно, должны стать
 * друзьями, а не зависнуть каждый со своей исходящей заявкой.
 */
export function planRequest(
  from: string,
  to: string,
  existing: Friendship | null,
): { action: "create" | "accept" } | { error: RequestError } {
  const relation = relationFor(from, to, existing);

  if (relation === "self") return { error: "self" };
  if (relation === "friends") return { error: "already_friends" };
  if (relation === "outgoing") return { error: "already_sent" };
  if (relation === "incoming") return { action: "accept" };
  return { action: "create" };
}

/** Новая заявка в каноническом виде. */
export function newRequest(from: string, to: string, now = Date.now()): Friendship {
  return { ...pairOf(from, to), requestedBy: from, status: "pending", createdAt: now };
}

/**
 * Может ли `viewer` принять эту заявку.
 *
 * Принимает только тот, кого позвали. Без этой проверки отправитель мог бы
 * принять собственную заявку и оказаться в друзьях у того, кто его не звал.
 */
export function canAccept(viewer: string, link: Friendship): boolean {
  return link.status === "pending" && link.requestedBy !== viewer;
}
