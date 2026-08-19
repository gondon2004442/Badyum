/**
 * Мост к десктопной обёртке.
 *
 * Клиент один и тот же для браузера и для приложения, поэтому зависимости от
 * Tauri здесь нет: обращаемся к глобальному объекту, который обёртка кладёт в
 * окно (`withGlobalTauri`). В браузере его просто нет, и всё сводится к no-op.
 */

interface TauriGlobal {
  event: {
    listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
  };
  core: {
    invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  };
}

function tauri(): TauriGlobal | null {
  const global = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return global?.event && global?.core ? global : null;
}

/** Запущены внутри десктопного приложения, а не во вкладке браузера. */
export function isDesktop(): boolean {
  return tauri() !== null;
}

/**
 * Системная рация.
 *
 * Именно это обёртка и добавляет к веб-версии: браузер не отдаёт клавишу, пока
 * окно не в фокусе, — то есть ровно тогда, когда рация и нужна. Здесь хоткей
 * перехватывается на уровне системы и работает поверх игры.
 *
 * Возвращает функцию отписки; в браузере — сразу no-op.
 */
export async function onGlobalPushToTalk(
  handler: (transmitting: boolean) => void,
): Promise<() => void> {
  const api = tauri();
  if (!api) return () => {};

  try {
    return await api.event.listen<{ down: boolean }>("badyum://ptt", (event) => {
      handler(event.payload.down);
    });
  } catch {
    // Обёртка есть, но событие не подписалось — рация просто не работает,
    // канал от этого не ломается.
    return () => {};
  }
}

/** Что на что забиндено. Подписи в интерфейсе берутся отсюда, а не из вёрстки. */
export interface Hotkeys {
  ptt: string;
  overlay: string;
}

/** Клавиши по умолчанию. Продублированы из `hotkeys.rs` для браузера. */
export const DEFAULT_HOTKEYS: Hotkeys = { ptt: "F8", overlay: "F9" };

/**
 * Что забиндено на самом деле.
 *
 * Спрашиваем обёртку, а не показываем зашитую подпись: клавишу мог занять
 * другой программой, и тогда написанное на экране расходится с тем, что
 * работает. Человек жмёт то, что написано, и решает, что сломалось приложение.
 */
export async function hotkeys(): Promise<Hotkeys | null> {
  const api = tauri();
  if (!api) return null;

  try {
    return await api.core.invoke<Hotkeys>("hotkeys");
  } catch {
    return null;
  }
}

/**
 * Переназначить клавиши.
 *
 * Обе сразу: проверка «рация и панель не совпадают» имеет смысл, только когда
 * известны оба значения. Ошибку возвращаем текстом — её показывают человеку,
 * потому что причин отказа несколько и они разные: занята другой программой,
 * совпала со второй, не разобралась вовсе.
 */
export async function setHotkeys(next: Hotkeys): Promise<Hotkeys> {
  const api = tauri();
  if (!api) throw new Error("клавиши настраиваются только в приложении");

  return await api.core.invoke<Hotkeys>("set_hotkeys", {
    ptt: next.ptt,
    overlay: next.overlay,
  });
}

/** Какая клавиша реально забинжена под рацию. */
export async function globalPushToTalkKey(): Promise<string | null> {
  return (await hotkeys())?.ptt ?? null;
}

/**
 * Нажали клавишу панели.
 *
 * Обёртка только сообщает о нажатии и окно не трогает: показывать панель
 * уместно лишь в канале, а знает об этом страница. Она и отвечает командой
 * `setOverlay`. Иначе стало бы возможным состояние «окно ужато, а панели нет».
 */
export async function onOverlayToggle(handler: () => void): Promise<() => void> {
  const api = tauri();
  if (!api) return () => {};

  try {
    return await api.event.listen<unknown>("badyum://overlay-toggle", () => handler());
  } catch {
    return () => {};
  }
}

/**
 * Ужать окно в панель поверх остальных или вернуть обратно.
 *
 * Вся геометрия — на стороне обёртки: странице она недоступна в принципе.
 */
export async function setOverlay(on: boolean): Promise<void> {
  const api = tauri();
  if (!api) return;

  try {
    await api.core.invoke("set_overlay", { on });
  } catch (error) {
    // Не смогли ужать окно — панель показывать нельзя, иначе человек увидит
    // обрезанный интерфейс во весь экран и не поймёт, что произошло.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Уведомление системы.
 *
 * Нужно ровно потому, что окно теперь прячется в трей, а не закрывается:
 * человек не сидит в приложении и о сообщении иначе не узнает. В браузере
 * ничего не делает — там вкладка и так на виду, а просить разрешение на
 * уведомления ради этого незачем.
 */
export async function notify(title: string, body: string): Promise<void> {
  const api = tauri();
  if (!api) return;

  try {
    await api.core.invoke("notify", { title, body });
  } catch {
    // Уведомления могли запретить системно — это право человека, и настаивать
    // нам не на чем. Разговор от этого не страдает.
  }
}

/** Запускается ли приложение вместе с системой. `null` — мы в браузере. */
export async function autostart(): Promise<boolean | null> {
  const api = tauri();
  if (!api) return null;

  try {
    return await api.core.invoke<boolean>("autostart");
  } catch {
    return null;
  }
}

/** Включить или выключить автозапуск. Ошибку показываем: причина бывает разной. */
export async function setAutostart(on: boolean): Promise<void> {
  const api = tauri();
  if (!api) throw new Error("автозапуск настраивается только в приложении");

  await api.core.invoke("set_autostart", { on });
}

/**
 * Вход через Google в отдельном окне.
 *
 * В браузере вход — обычный переход по ссылке. В приложении так нельзя:
 * страница лежит в его файлах, и уведи мы окно на сервер, приложение
 * превратилось бы в сайт и обратно не вернулось.
 *
 * `false` — мы в браузере, надо идти по ссылке как раньше.
 */
export async function loginInWindow(url: string, server: string): Promise<boolean> {
  const api = tauri();
  if (!api) return false;

  await api.core.invoke("login", { url, server });
  return true;
}
