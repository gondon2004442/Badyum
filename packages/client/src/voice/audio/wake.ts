/**
 * Возвращать аудиоконтекст к жизни, когда браузер его усыпил.
 *
 * Это не перестраховка, а починка настоящей поломки: на телефоне достаточно
 * открыть галерею, чтобы приложить картинку, — вкладка уходит в фон, браузер
 * останавливает AudioContext, и сам он обратно не заводится. Через контекст
 * идёт весь звук: входящий через микшер, исходящий через шумодав. Человек
 * возвращается в разговор, где его больше не слышно и он не слышит никого,
 * причём выглядит всё исправным.
 *
 * `resume()` на телефоне не всегда срабатывает без пользовательского жеста,
 * поэтому цепляемся за три события сразу: возврат вкладки, попытку системы
 * усыпить контекст и любое касание экрана. Что-то из этого сработает.
 */

/** Сколько ждём между попытками, когда resume() отклонили. */
const RETRY_MS = 400;
const MAX_TRIES = 5;

export interface WakeHandle {
  stop(): void;
}

export function keepAwake(context: AudioContext): WakeHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const wake = (tries = 0): void => {
    if (stopped || context.state !== "suspended") return;

    void context.resume().catch(() => {
      /*
        До жеста браузер вправе отказать. Пробуем ещё несколько раз с паузой:
        на Android контекст просыпается сразу после возврата вкладки, на iOS
        часто только после первого касания — и тогда сработает listener ниже.
      */
      if (tries + 1 >= MAX_TRIES) return;
      timer = setTimeout(() => wake(tries + 1), RETRY_MS);
    });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") wake();
  };

  const onState = () => wake();
  // Касание — тот самый жест, которого ждёт iOS. Ставим в capture, чтобы
  // сработать раньше, чем обработчик кнопки остановит всплытие.
  const onTouch = () => wake();

  // Контекст сообщает о собственной остановке сам — это самый прямой сигнал,
  // и он приходит даже там, где visibilitychange не срабатывает.
  context.addEventListener("statechange", onState);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("pageshow", onVisible);
  window.addEventListener("pointerdown", onTouch, { capture: true });

  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      context.removeEventListener("statechange", onState);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("pointerdown", onTouch, { capture: true });
    },
  };
}
