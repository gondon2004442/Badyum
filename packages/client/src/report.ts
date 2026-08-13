/**
 * Рассказать серверу о собственной поломке.
 *
 * Все настоящие ошибки этого проекта нашлись не типами и не тестами, а тем,
 * что кто-то открыл два браузера и попробовал. С телефона в чужой сети такого
 * браузера у нас нет, и «у меня не работает» приходится разгадывать. Это —
 * замена ему.
 *
 * Три правила, которые здесь важнее удобства:
 *
 *  1. Отправка не имеет права уронить приложение. Всё в try/catch, и любая
 *     неудача — молчание, а не вторая ошибка поверх первой.
 *  2. Отправка не имеет права съесть суточный лимит запросов. Каждая ошибка
 *     уходит однажды, и их не больше горстки за вкладку.
 *  3. Мы не перехватываем ошибку у браузера. Консоль обязана показать её так
 *     же, как показывала бы без нас: иначе разработка станет слепой ради того,
 *     чтобы зрячей стала поддержка.
 */
import { ReportBudget, redactPath, trimMessage, trimStack } from "@badyum/shared";
import { apiOrigin } from "./api.ts";

/**
 * Сколько разных ошибок вкладка расскажет за свою жизнь.
 *
 * После нескольких первых новые уже ничего не добавляют: у настоящей поломки
 * лавина следствий, а причина — в самом начале.
 */
const MAX_PER_TAB = 5;

const budget = new ReportBudget(MAX_PER_TAB);

/** Замолкли навсегда: сервер сказал «хватит» либо отправлять нечем. */
let silenced = false;
/** Мы прямо сейчас внутри отправки — ошибку из неё самой слать нельзя. */
let sending = false;

/**
 * Сообщить о поломке.
 *
 * `where` — не текст ошибки, а место: `mic`, `denoise`, `join`. По нему видно,
 * что именно сломалось, даже когда сообщение браузера бесполезно вроде
 * «Load failed».
 */
export function report(where: string, error: unknown): void {
  if (silenced || sending) return;

  try {
    const draft = {
      kind: where,
      message: messageOf(error),
      stack: trimStack(error instanceof Error ? error.stack : undefined),
    };
    if (!budget.admit(draft)) return;

    send({
      kind: draft.kind,
      message: trimMessage(draft.message),
      stack: draft.stack,
      page: redactPath(location.href),
      build: buildId(),
    });
  } catch {
    // Сломался сам сборщик поломок — молчим. Ошибка в нём не должна выглядеть
    // как ошибка приложения.
  }
}

/**
 * Повесить перехватчики на всё, что браузер сообщает сам.
 *
 * Вызывается один раз при старте. Не `preventDefault` и не возвращает `true`:
 * ошибка обязана дойти до консоли ровно так же, как дошла бы без нас.
 */
export function installErrorReporting(): void {
  try {
    window.addEventListener("error", (event) => {
      // ErrorEvent приходит и на неудавшуюся загрузку картинки — у неё нет
      // ни error, ни смысла: сеть моргнула, приложение цело.
      if (!event.error && !event.message) return;
      report("onerror", event.error ?? event.message);
    });

    window.addEventListener("unhandledrejection", (event) => {
      report("unhandledrejection", event.reason);
    });
  } catch {
    silenced = true;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // Имя обязательно: «NotAllowedError» объясняет отказ микрофона, а само
    // сообщение у DOMException часто пустое.
    return error.name && error.name !== "Error"
      ? `${error.name}: ${error.message}`
      : error.message || String(error);
  }
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

interface Payload {
  kind: string;
  message: string;
  stack?: string | undefined;
  page: string;
  build: string;
}

function send(payload: Payload): void {
  sending = true;
  try {
    const body = JSON.stringify(payload);
    const url = `${apiOrigin()}/api/report`;

    /*
      sendBeacon, а не fetch: ошибка часто случается ровно в тот момент, когда
      страница уходит — при выходе из канала, при закрытии вкладки, — и обычный
      запрос браузер в этот момент отменяет. Beacon он обязан доставить.

      Он не отдаёт ответ, поэтому 429 от сервера мы по этому пути не увидим;
      сдержанность обеспечивает свой потолок, а серверный лимит остаётся
      защитой от того, кто пишет в ручку нарочно.
    */
    const beacon = navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }));
    if (beacon) return;

    void fetch(url, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      credentials: "include",
      // Переживает уход страницы — по той же причине, что и beacon.
      keepalive: true,
    })
      .then((response) => {
        // Сервер попросил замолчать — замолкаем до перезагрузки. Долбиться в
        // закрытую дверь значит тратить те самые запросы, которые он бережёт.
        if (response.status === 429) silenced = true;
      })
      .catch(() => {
        // Нет сети — тот случай, когда рассказать о поломке всё равно некому.
      });
  } catch {
    silenced = true;
  } finally {
    sending = false;
  }
}

/** Какая сборка сломалась. Без этого не отличить «уже починили» от «не чинили». */
function buildId(): string {
  try {
    return __BADYUM_BUILD__;
  } catch {
    return "unknown";
  }
}
