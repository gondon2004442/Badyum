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

/** Какая клавиша реально забинжена под рацию. */
export async function globalPushToTalkKey(): Promise<string | null> {
  const api = tauri();
  if (!api) return null;

  try {
    return await api.core.invoke<string>("ptt_hotkey");
  } catch {
    return null;
  }
}
