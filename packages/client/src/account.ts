import { useCallback, useSyncExternalStore } from "react";
import { publicOrigin } from "./api.ts";
import { myName } from "./storage.ts";

export interface Account {
  id: string;
  /** Юз, по которому находят. `null` — ещё не выбрал: см. UsernameScreen. */
  username: string | null;
  /** Ник и тег — прошлый способ адресации. Останутся до чистки схемы. */
  nick: string;
  tag: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Как человека зовут на экране.
 *
 * Имя из профиля, а не юз: «Максим Иванов» читается, а «dumax» опознаётся.
 * Имя есть всегда — и у вошедшего от Google, и у гостя, который его ввёл, —
 * поэтому дыры вместо человека тут не бывает.
 */
export const nameOf = (who: { displayName: string }): string => who.displayName;

/**
 * Юз с собачкой — то, что диктуют, чтобы тебя нашли.
 *
 * `null`, пока юз не выбран: показывать одинокую «@» хуже, чем не показывать
 * ничего, — это читается как сбой, а не как «ещё не заполнено».
 */
export const handleOf = (who: { username: string | null }): string | null =>
  who.username ? `@${who.username}` : null;

interface MeResponse {
  user: Account | null;
  googleEnabled: boolean;
}

/**
 * Кто вошёл.
 *
 * `null` в поле `account` — это не ошибка и не «ещё грузится», а полноценный
 * режим работы: гость по ссылке никуда не входит и не должен. Поэтому
 * `loading` отдельным полем, а не через `account === null`.
 */
export interface AccountState {
  account: Account | null;
  /** Настроен ли вход вообще. Кнопку без этого показывать нельзя. */
  available: boolean;
  loading: boolean;
  logout: () => Promise<void>;
  /** Юз выбран — обновляем общий стор, чтобы не перезагружать страницу. */
  setUsername: (username: string) => void;
}

/**
 * Состояние общее на всё приложение, а не своё у каждого вызова хука.
 *
 * Хук висит и в сайдбаре, и в App — на бесплатном тарифе каждый запрос
 * считается, и три одинаковых `/api/me` при открытии страницы это чистая
 * растрата. Заодно выход из аккаунта в одном месте виден сразу везде.
 */
type Snapshot = Omit<AccountState, "logout" | "setUsername">;

let snapshot: Snapshot = { account: null, available: false, loading: true };
const listeners = new Set<() => void>();
let started = false;

function set(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;

  void fetch(`${publicOrigin()}/api/me`, { credentials: "include" })
    .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
    .then((data) => {
      if (data) set({ account: data.user, available: data.googleEnabled, loading: false });
      else set({ ...snapshot, loading: false });
    })
    // Молча: аккаунт — необязательная часть, и её недоступность не должна
    // мешать человеку зайти в канал по ссылке.
    .catch(() => set({ ...snapshot, loading: false }));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

/** Адрес, с которого начинается вход. Возвращает туда, откуда ушли. */
export function loginUrl(): string {
  const back = `${location.pathname}${location.search}`;
  return `${publicOrigin()}/api/auth/google?back=${encodeURIComponent(back)}`;
}

/**
 * Под каким именем заходить в канал.
 *
 * Имя, сохранённое в этом браузере, сильнее ника аккаунта: его человек ввёл
 * сам — в настройках или на экране входа — и молча его переименовывать нельзя.
 * Ник подставляется там, где имени ещё нет, и это главная выгода от входа:
 * второй раз представляться не надо.
 */
export function nameFor(account: Account | null): string {
  return myName() || account?.displayName || "гость";
}

export function useAccount(): AccountState {
  const state = useSyncExternalStore(subscribe, () => snapshot);

  const logout = useCallback(async () => {
    await fetch(`${publicOrigin()}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    set({ ...snapshot, account: null });
  }, []);

  const setUsername = useCallback((username: string) => {
    if (snapshot.account) set({ ...snapshot, account: { ...snapshot.account, username } });
  }, []);

  return { ...state, logout, setUsername };
}
