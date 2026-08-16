import { apiOrigin } from "./api.ts";

/**
 * Своя аватарка: обрезка и отправка.
 *
 * Обрезаем и сжимаем прямо в браузере, а не на сервере. Причин две. Первая
 * техническая: в Worker'е нет кодека картинок, и приделать его туда дорого, а
 * в браузере canvas есть везде. Вторая важнее — люди присылают фотографии с
 * телефона по восемь мегабайт, и гонять их через сеть, чтобы потом показывать
 * квадратиком 34×34, бессмысленно. После обрезки уезжают десятки килобайт.
 */

/**
 * Сторона квадрата.
 *
 * 256 с запасом: самое крупное место, где аватарка появляется, — плитка в
 * канале, 70 пикселей. Двойной запас нужен для экранов с высокой плотностью,
 * тройной уже не виден никому.
 */
const SIDE = 256;

/** Ниже этого качество заметно сыплется на лицах, выше — растёт только вес. */
const QUALITY = 0.86;

export class AvatarError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "AvatarError";
  }
}

const WHY: Record<string, string> = {
  not_an_image: "Это не картинка",
  too_big: "Файл слишком большой",
  auth_required: "Нужно войти",
  files_disabled: "Хранилище не настроено",
  decode: "Не удалось прочитать картинку",
};

export function describeAvatar(error: unknown): string {
  if (error instanceof AvatarError) return WHY[error.code] ?? "Не получилось поставить аватарку";
  return "Аватарка не загрузилась — проверь связь";
}

/** Какой кусок картинки берём. Всё в пикселях исходника. */
export interface Crop {
  x: number;
  y: number;
  /** Сторона квадрата. Квадрат, потому что аватарка всегда квадратная. */
  size: number;
}

/**
 * Нарисовать выбранный кусок и сжать.
 *
 * Кусок выбирает человек в редакторе — обрезка по центру угадывала не всегда,
 * а лицо на фотографии сплошь и рядом не в середине.
 */
export async function renderSquare(source: CanvasImageSource, crop: Crop): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarError("decode");
  // Без сглаживания уменьшенная фотография выглядит рваной.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, crop.x, crop.y, crop.size, crop.size, 0, 0, SIDE, SIDE);

  /*
    JPEG, а не WebP или PNG. PNG на фотографии даёт файл в разы тяжелее без
    выигрыша в качестве, а WebP отдают не все браузеры через canvas — и узнать
    об этом пришлось бы уже на отправке. JPEG умеют все.
  */
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", QUALITY);
  });
  if (!blob) throw new AvatarError("decode");
  return blob;
}

/**
 * Открыть выбранный файл как картинку.
 *
 * Через <img> и blob-ссылку, а не createImageBitmap: тот же элемент показывается
 * человеку в редакторе и он же потом рисуется в canvas. Второе представление той
 * же картинки в памяти телефона лишнее, а blob-ссылка не портит canvas — она
 * своего происхождения.
 */
export function openImage(file: File): Promise<{ image: HTMLImageElement; release: () => void }> {
  if (!file.type.startsWith("image/")) return Promise.reject(new AvatarError("not_an_image"));

  const url = URL.createObjectURL(file);
  const release = () => URL.revokeObjectURL(url);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, release });
    image.onerror = () => {
      release();
      // Битый файл, неизвестный формат, HEIC на старом браузере — для человека
      // это всё одно и то же: «эта картинка не подошла».
      reject(new AvatarError("decode"));
    };
    image.src = url;
  });
}

/** Отправить уже обрезанный квадрат. Возвращает адрес новой аватарки. */
export async function uploadAvatar(square: Blob): Promise<string | null> {
  const response = await fetch(`${apiOrigin()}/api/avatar`, {
    method: "POST",
    body: square,
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new AvatarError(body.error ?? "failed");
  }

  const body = (await response.json()) as { avatarUrl: string | null };
  return body.avatarUrl;
}

/** Снять свою аватарку. Останется гугловая, а без неё — инициалы. */
export async function removeAvatar(): Promise<string | null> {
  const response = await fetch(`${apiOrigin()}/api/avatar`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) throw new AvatarError("failed");
  const body = (await response.json()) as { avatarUrl: string | null };
  return body.avatarUrl;
}
