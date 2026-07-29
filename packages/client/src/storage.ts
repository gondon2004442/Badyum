/**
 * Что клиент помнит между запусками.
 *
 * Всё лежит в localStorage: сервер держит каналы в памяти и никого не
 * опознаёт, так что «мои каналы» и «с кем я говорил» существуют только здесь.
 */

const KEY_IDENTITY = "badyum:identity";
const KEY_NAME = "badyum:name";
const KEY_CHANNELS = "badyum:channels";
const KEY_PEOPLE = "badyum:people";

const RECENT_CHANNELS_LIMIT = 12;
const RECENT_PEOPLE_LIMIT = 40;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Повреждённое или недоступное хранилище не должно ронять приложение:
    // без истории оно работает, просто забывает.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Приватный режим или переполнение — молча живём без памяти.
  }
}

/**
 * Устойчивый идентификатор этого устройства.
 *
 * `userId` выдаётся сервером на одну сессию, поэтому по нему нельзя узнать
 * человека завтра. Этот — генерируется один раз и живёт, пока не почистят
 * браузер. Он же уходит на сервер и попадает к собеседникам, чтобы они могли
 * запомнить нас в «людях».
 */
export function myIdentityId(): string {
  const existing = read<string | null>(KEY_IDENTITY, null);
  if (existing && /^[a-z0-9]{16,32}$/.test(existing)) return existing;

  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const id = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);

  write(KEY_IDENTITY, id);
  return id;
}

export function myName(): string {
  return read<string>(KEY_NAME, "");
}

export function rememberMyName(name: string): void {
  write(KEY_NAME, name);
}

// ---------------------------------------------------------------------------
// Недавние каналы
// ---------------------------------------------------------------------------

export interface RecentChannel {
  channelId: string;
  name: string;
  /** Код инвайта — без него вернуться в канал нечем. */
  code: string | null;
  lastSeen: number;
}

export function recentChannels(): RecentChannel[] {
  return read<RecentChannel[]>(KEY_CHANNELS, []).sort((a, b) => b.lastSeen - a.lastSeen);
}

export function rememberChannel(entry: Omit<RecentChannel, "lastSeen">): void {
  const others = recentChannels().filter((c) => c.channelId !== entry.channelId);
  const updated: RecentChannel[] = [{ ...entry, lastSeen: Date.now() }, ...others];
  write(KEY_CHANNELS, updated.slice(0, RECENT_CHANNELS_LIMIT));
}

export function forgetChannel(channelId: string): void {
  write(
    KEY_CHANNELS,
    recentChannels().filter((c) => c.channelId !== channelId),
  );
}

// ---------------------------------------------------------------------------
// Люди
// ---------------------------------------------------------------------------

export interface KnownPerson {
  identityId: string;
  displayName: string;
  lastSeen: number;
  /** Где виделись в последний раз — так список читается как история, а не свалка. */
  lastChannel: string;
}

export function knownPeople(): KnownPerson[] {
  return read<KnownPerson[]>(KEY_PEOPLE, []).sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * Запоминает встреченного человека.
 *
 * Только тех, у кого есть устойчивый идентификатор: остальных мы всё равно не
 * узнаем при следующей встрече, и в списке они были бы мусором.
 */
export function rememberPerson(person: {
  identityId: string | null;
  displayName: string;
  channelName: string;
}): void {
  if (!person.identityId) return;

  const others = knownPeople().filter((p) => p.identityId !== person.identityId);
  const updated: KnownPerson[] = [
    {
      identityId: person.identityId,
      displayName: person.displayName,
      lastChannel: person.channelName,
      lastSeen: Date.now(),
    },
    ...others,
  ];
  write(KEY_PEOPLE, updated.slice(0, RECENT_PEOPLE_LIMIT));
}

export function forgetPerson(identityId: string): void {
  write(
    KEY_PEOPLE,
    knownPeople().filter((p) => p.identityId !== identityId),
  );
}
