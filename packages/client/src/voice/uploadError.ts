/**
 * Почему файл не уехал — словами, из которых понятно, что делать.
 *
 * Отдельным классом, а не строкой: код нужен и движку (решить, стоит ли
 * повторять), и экрану (что написать человеку), а придумывать текст в движке —
 * значит зашивать русский язык туда, где ему не место.
 */
export class UploadError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "UploadError";
  }
}

const WHY: Record<string, string> = {
  too_big: "Файл больше 10 МБ",
  not_joined: "Ещё подключаюсь к каналу — попробуй через секунду",
  files_disabled: "Вложения на этом сервере не настроены",
  bad_token: "Сессия устарела — перезайди в канал",
  empty: "Файл пустой",
};

export function describeUpload(error: unknown): string {
  if (error instanceof UploadError) {
    return WHY[error.code] ?? "Не получилось загрузить файл";
  }
  // Сеть отвалилась посреди загрузки — самый частый случай, и он не про файл.
  return "Файл не загрузился — проверь связь";
}
