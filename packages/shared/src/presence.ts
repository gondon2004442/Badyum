import { z } from "zod";

/**
 * Протокол присутствия и личных звонков.
 *
 * Отдельно от протокола канала намеренно: там разговор, здесь — кто в сети и
 * кто кому звонит. Соединение тоже отдельное, одно на вошедшего, и живёт оно
 * всё время, пока открыт сайт, а не пока идёт разговор.
 *
 * Почему звонок ходит здесь, а не по обычному HTTP: тому, кому звонят, надо
 * сообщить прямо сейчас, а не когда он в следующий раз что-нибудь спросит.
 * Опрашивать сервер каждые несколько секунд на бесплатном тарифе нельзя —
 * каждый запрос считается.
 */

/** Кто участвует в звонке — ровно то, что нужно нарисовать на экране вызова. */
export const callerSchema = z.object({
  userId: z.string(),
  nick: z.string(),
  tag: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

export type Caller = z.infer<typeof callerSchema>;

export const presenceClientSchema = z.discriminatedUnion("type", [
  /** Дай снимок: кто из моих друзей сейчас в сети. */
  z.object({ type: z.literal("sync") }),
  /**
   * Позвонить другу.
   *
   * Идентификатор звонка задаёт звонящий, а не сервер. Иначе на отказ («его
   * нет в сети») сервер отвечал бы про звонок, о котором клиент ещё не знает,
   * и связать ответ с попыткой было бы нечем.
   */
  z.object({ type: z.literal("call"), to: z.string().max(64), callId: z.string().max(64) }),
  /** Принять входящий. */
  z.object({ type: z.literal("call_accept"), callId: z.string().max(64) }),
  /**
   * Отказаться или прекратить.
   *
   * Одно сообщение на «сбросил», «передумал звонить» и «не дождался»: с какой
   * стороны ни нажми, звонок кончается одинаково, и разные слова нужны только
   * в интерфейсе.
   */
  z.object({ type: z.literal("call_end"), callId: z.string().max(64) }),
]);

export type PresenceClientMessage = z.infer<typeof presenceClientSchema>;

export type PresenceServerMessage =
  /** Снимок при подключении и после изменений списка друзей. */
  | { type: "online"; userIds: string[] }
  /** Друг зашёл или ушёл. */
  | { type: "presence"; userId: string; online: boolean }
  /** Тебе звонят. `code` — инвайт канала, по нему и заходят, если примешь. */
  | { type: "call_incoming"; callId: string; from: Caller; code: string }
  /** Твой звонок пошёл: собеседник в сети, у него звонит. */
  | { type: "call_ringing"; callId: string; to: Caller; code: string }
  /** Приняли — заходи в канал. */
  | { type: "call_accepted"; callId: string; code: string }
  /**
   * Звонок кончился, не начавшись.
   *
   * `reason` не для галочки: «отказался» и «его нет в сети» человек должен
   * различать, иначе он будет перезванивать в пустоту.
   */
  | {
      type: "call_ended";
      callId: string;
      reason: "declined" | "cancelled" | "offline" | "busy" | "not_friends" | "gone";
    };
