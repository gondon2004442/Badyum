/**
 * Захват экрана.
 *
 * Отдельный модуль ради одной вещи: `getDisplayMedia` есть не везде, и знать
 * об этом надо ДО того, как показать кнопку. Кнопка, которая молча ничего не
 * делает, хуже отсутствующей — человек решает, что сломалось приложение.
 */

/** Показ отсюда невозможен: браузер не умеет отдавать экран. */
export class NoScreenShareError extends Error {
  constructor() {
    super("этот браузер не умеет показывать экран");
    this.name = "NoScreenShareError";
  }
}

/**
 * Умеет ли этот браузер показывать экран.
 *
 * Главный отказ — Safari на iPhone и iPad: `getDisplayMedia` там нет вовсе, и
 * появиться ему неоткуда, потому что система не даёт странице доступ к экрану.
 * Смотреть чужой показ с телефона при этом можно — это обычное входящее видео,
 * и оно работает.
 */
export function canShareScreen(): boolean {
  return typeof navigator?.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Попросить экран.
 *
 * Звук просим тоже. Отдать его согласны не все и не всегда — Chrome предлагает
 * при показе вкладки и всего экрана, при показе отдельного окна нет, а Firefox
 * не предлагает вовсе, — но когда он есть, «посмотреть видео вместе» начинает
 * работать само собой. Нет звука — просто нет дорожки, ничего чинить не нужно.
 */
export async function captureScreen(): Promise<MediaStream> {
  if (!canShareScreen()) throw new NoScreenShareError();

  return navigator.mediaDevices.getDisplayMedia({
    video: {
      // Потолок, а не требование: браузер отдаст меньше, если экран меньше.
      // 30 кадров хватает игре, а 60 удваивают поток ради того, чего на сжатом
      // до полутора мегабит видео всё равно не разглядеть.
      frameRate: { ideal: 30, max: 30 },
      width: { max: 1920 },
      height: { max: 1080 },
    },
    audio: true,
  });
}

/**
 * Сколько отдавать на каждого зрителя.
 *
 * В mesh поток копируется каждому: втроём один и тот же экран уходит дважды,
 * вчетвером — трижды. Домашний upstream это кончает быстро, и первым сыпется
 * не картинка, а голос — он идёт по тому же каналу. Поэтому потолок делится.
 *
 * Нижняя граница — не «красиво», а «хоть что-то видно»: ниже 400 кбит/с
 * картинка превращается в кашу, и показывать её смысла уже нет.
 */
export function bitrateFor(viewers: number): number {
  const TOTAL = 2_500_000;
  const FLOOR = 400_000;
  return Math.max(FLOOR, Math.floor(TOTAL / Math.max(1, viewers)));
}

/**
 * Почему показать не вышло — словами.
 *
 * Отказ в системном диалоге — не поломка: человек передумал, и говорить ему об
 * этом нечего. Возвращаем null, чтобы вызывающий промолчал.
 */
export function describeScreenError(error: unknown): string | null {
  if (error instanceof NoScreenShareError) {
    return "Этот браузер не умеет показывать экран. С iPhone показать нельзя — смотреть можно.";
  }
  if (error instanceof DOMException) {
    // NotAllowedError здесь почти всегда «нажал Отмена в системном окне».
    if (error.name === "NotAllowedError") return null;
    if (error.name === "NotFoundError") return "Нечего показывать — нет доступного экрана";
  }
  return "Не получилось начать показ";
}
