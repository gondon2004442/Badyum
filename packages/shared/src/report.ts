/**
 * Что клиент вправе рассказать о своей поломке.
 *
 * Здесь только правила: что считать одной и той же ошибкой, сколько их слать и
 * как обрезать. Отправка и перехват живут в клиенте, запись — в Worker'е;
 * решение «слать или молчать» вынесено сюда, потому что оно единственное, что
 * можно проверить тестом, и единственное, цена ошибки в котором — суточный
 * лимит запросов на всех.
 */

/** Кадров стека хватает столько: дальше идёт внутренность React и рантайма. */
const STACK_FRAMES = 6;
const MESSAGE_LIMIT = 300;

export interface ReportDraft {
  /** Откуда: `onerror`, `unhandledrejection`, `mic`, `denoise`… */
  kind: string;
  message: string;
  stack?: string | undefined;
}

/**
 * Отпечаток ошибки: одинаковый у повторов, разный у разных поломок.
 *
 * Берём вид, текст и первый кадр стека. Номера строк намеренно не выбрасываем —
 * две ошибки с одним текстом из разных мест это разные ошибки, — но и весь стек
 * не берём: он отличается у одной и той же поломки, пришедшей разными путями.
 */
export function signatureOf(draft: ReportDraft): string {
  const frame = (draft.stack ?? "").split("\n").find((l) => l.includes("at ")) ?? "";
  return [draft.kind, trimMessage(draft.message), frame.trim()].join("|");
}

export function trimMessage(message: string): string {
  const value = message.trim().replace(/\s+/g, " ");
  return value.length > MESSAGE_LIMIT ? `${value.slice(0, MESSAGE_LIMIT)}…` : value;
}

export function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return stack.split("\n").slice(0, STACK_FRAMES).join("\n").slice(0, 2000);
}

/**
 * Убрать из адреса то, что пускает в канал.
 *
 * В пути живут инвайт-код и кодовое слово. Для разбора поломки важно, на каком
 * экране она случилась, а не в какой именно канал человек шёл, — а код это
 * ключ: попав в журнал, он остаётся там навсегда и пускает всякого, кто журнал
 * прочитает.
 */
export function redactPath(rawUrl: string): string {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    path = rawUrl;
  }
  return path.replace(/^\/(j|r)\/[^/]+/, "/$1/…").slice(0, 120);
}

/**
 * Сколько ошибок эта вкладка вправе отправить.
 *
 * Два ограничения, и оба обязательны. Повторы: сломанный `setInterval` шлёт
 * одно и то же двадцать раз в секунду, и без отсева он один выест суточный
 * лимит запросов на всех. Потолок: у поломки бывает лавина разных ошибок
 * подряд, и после первых нескольких новые уже ничего не добавляют к разбору.
 *
 * Состояние живёт в памяти вкладки и намеренно не переживает перезагрузку:
 * человек, который вернулся и снова словил ошибку, сообщает о ней заново — это
 * ровно то, что нужно знать.
 */
export class ReportBudget {
  private readonly seen = new Set<string>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  /**
   * Пропустить ошибку и запомнить её, либо отказать.
   *
   * Отказ повтору не расходует потолок: иначе одна зациклившаяся ошибка
   * съедала бы место, отведённое остальным, и настоящую причину поломки мы бы
   * так и не увидели.
   */
  admit(draft: ReportDraft): boolean {
    const signature = signatureOf(draft);
    if (this.seen.has(signature)) return false;
    if (this.seen.size >= this.max) return false;

    this.seen.add(signature);
    return true;
  }

  /** Сколько разных ошибок ещё готовы принять. Для диагностики самой отправки. */
  get left(): number {
    return Math.max(0, this.max - this.seen.size);
  }
}
