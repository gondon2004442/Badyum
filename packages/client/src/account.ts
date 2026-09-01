import { useCallback, useSyncExternalStore } from "react";
import { publicOrigin } from "./api.ts";
import { loginInWindow } from "./desktop.ts";
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
  /**
   * Вход идёт прямо сейчас.
   *
   * В приложении между нажатием и появлением аккаунта проходит до сорока
   * секунд: окно входа живёт отдельно, и о его исходе мы узнаём, переспрашивая
   * сервер. Без этого признака кнопка всё это время выглядит ненажатой, и
   * человек жмёт её второй раз.
   */
  loggingIn: boolean;
  /**
   * Почему вход не удался. `null` — не было отказа.
   *
   * Сервер и так уводит на `/?auth=failed` и `/?auth=expired`, но раньше эту
   * метку никто не читал: человек возвращался на домашний экран ровно в том же
   * виде, будто и не нажимал, и жал снова. Молчание после нажатия — худший из
   * возможных ответов.
   */
  loginProblem: string | null;
  logout: () => Promise<void>;
  /** Юз выбран — обновляем общий стор, чтобы не перезагружать страницу. */
  setUsername: (username: string) => void;
  /** Поставить или снять аватарку — во всём приложении разом. */
  setAvatar: (avatarUrl: string | null) => void;
}

/**
 * Состояние общее на всё приложение, а не своё у каждого вызова хука.
 *
 * Хук висит и в сайдбаре, и в App — на бесплатном тарифе каждый запрос
 * считается, и три одинаковых `/api/me` при открытии страницы это чистая
 * растрата. Заодно выход из аккаунта в одном месте виден сразу везде.
 */
type Snapshot = Omit<AccountState, "logout" | "setUsername" | "setAvatar">;

let snapshot: Snapshot = {
  account: null,
  available: false,
  loading: true,
  loggingIn: false,
  loginProblem: null,
};
const listeners = new Set<() => void>();
let started = false;

function set(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Спросить сервер, кто мы.
 *
 * Отдельно от `start`, потому что нужно ещё и после входа: кука к тому моменту
 * выдана, а состояние на странице о ней не знает.
 */
async function refresh(): Promise<void> {
  try {
    const response = await fetch(`${publicOrigin()}/api/me`, { credentials: "include" });
    const data = response.ok ? ((await response.json()) as MeResponse) : null;

    // loginProblem и loggingIn сюда не входят: refresh отвечает на вопрос «кто
    // мы», а не «чем кончилось нажатие», и затирать чужое состояние ему нечем.
    if (data) {
      set({ ...snapshot, account: data.user, available: data.googleEnabled, loading: false });
    } else {
      set({ ...snapshot, loading: false });
    }
  } catch {
    // Молча: аккаунт — необязательная часть, и её недоступность не должна
    // мешать человеку зайти в канал по ссылке.
    set({ ...snapshot, loading: false });
  }
}

/**
 * Чем кончился прошлый вход.
 *
 * Метку ставит сервер, уводя обратно после отказа. Прочитав, стираем её из
 * адреса: иначе она переживёт перезагрузку страницы и человек увидит жалобу на
 * вход, которого не начинал.
 */
function readAuthOutcome(): string | null {
  const params = new URLSearchParams(location.search);
  const outcome = params.get("auth");
  if (!outcome) return null;

  params.delete("auth");
  const rest = params.toString();
  history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);

  if (outcome === "expired") return "Вход занял слишком много времени. Попробуй ещё раз";
  return "Google не подтвердил вход. Попробуй ещё раз";
}

function start(): void {
  if (started) return;
  started = true;
  const problem = readAuthOutcome();
  if (problem) set({ ...snapshot, loginProblem: problem });
  void refresh();
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

/** Сколько ждём возвращения из окна входа и с какой частотой переспрашиваем. */
const LOGIN_TRIES = 40;
const LOGIN_STEP_MS = 1000;

/**
 * Начать вход.
 *
 * В браузере — переход по ссылке, как и было. В приложении ссылка увела бы окно
 * на сайт и назад не вернула, поэтому вход открывается отдельным окном; оно
 * закрывается само, как только Google отпустит.
 *
 * Дальше переспрашиваем сервер. Событие «вход закончился» пришлось бы тащить
 * из обёртки отдельным каналом, а вход — действие редкое и заметное: несколько
 * попыток с паузой стоят дешевле лишнего механизма. Останавливаемся, как
 * только узнали человека.
 */
export async function startLogin(): Promise<void> {
  // Прошлая жалоба к этой попытке отношения не имеет.
  set({ ...snapshot, loginProblem: null, loggingIn: true });

  let opened: boolean;
  try {
    opened = await loginInWindow(loginUrl(), publicOrigin() || location.origin);
  } catch {
    set({ ...snapshot, loggingIn: false, loginProblem: "Не удалось открыть окно входа" });
    return;
  }

  if (!opened) {
    // Браузер: уходим на сервер целиком, и это последнее, что делает страница.
    // Признак «идёт вход» остаётся включённым намеренно — до перехода остаются
    // доли секунды, и погасшая кнопка успела бы мигнуть.
    location.href = loginUrl();
    return;
  }

  for (let attempt = 0; attempt < LOGIN_TRIES; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, LOGIN_STEP_MS));
    await refresh();
    if (snapshot.account) {
      set({ ...snapshot, loggingIn: false, loginProblem: null });
      return;
    }
  }

  /*
    Сорок секунд прошло, аккаунта нет.

    Причин много и различить их отсюда нечем: окно закрыли, Google отказал,
    сеть пропала. Поэтому говорим о факте, а не о причине, — и главное, вообще
    говорим: раньше здесь цикл просто заканчивался.
  */
  set({
    ...snapshot,
    loggingIn: false,
    loginProblem: "Вход не завершился. Проверь, что окно Google не закрылось раньше времени",
  });
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

  /**
   * Обновить аватарку во всём приложении разом.
   *
   * Не перезапрос `/api/me`, а точечная правка снимка: адрес новой картинки нам
   * уже вернула сама загрузка, а лишний запрос на бесплатном плане стоит ровно
   * столько же, сколько любой другой.
   */
  const setAvatar = useCallback((avatarUrl: string | null) => {
    if (snapshot.account) set({ ...snapshot, account: { ...snapshot.account, avatarUrl } });
  }, []);

  return { ...state, logout, setUsername, setAvatar };
}
