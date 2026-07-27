import { z } from "zod";

/**
 * Протокол сигналинга Badyum.
 *
 * Сервер НЕ разбирает медиа: он знает только "кто в какой комнате" и пересылает
 * конверты `signal` между участниками. Поэтому полезная нагрузка SDP/ICE описана
 * максимально свободно — её единственный потребитель это RTCPeerConnection.
 */

export const PROTOCOL_VERSION = 1;

/** Идентификатор участника внутри одной сессии канала. */
export const userIdSchema = z.string().min(1).max(64);

export const participantSchema = z.object({
  userId: userIdSchema,
  displayName: z.string().min(1).max(32),
  /** Микрофон выключен — участника не слышно. */
  muted: z.boolean(),
  /** Участник "оглох" — сам никого не слышит (и подразумевает muted). */
  deafened: z.boolean(),
  /** Говорит прямо сейчас. Считается локально самим участником, см. audio/vad. */
  speaking: z.boolean(),
});
export type Participant = z.infer<typeof participantSchema>;

/**
 * SDP-оффер/ответ и ICE-кандидаты. Пропускаем как есть — валидация здесь только
 * защищает сервер от мусора, а не описывает семантику WebRTC.
 */
export const signalPayloadSchema = z.union([
  z.object({
    kind: z.literal("description"),
    description: z.object({
      type: z.enum(["offer", "answer", "pranswer", "rollback"]),
      sdp: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal("candidate"),
    candidate: z
      .object({
        candidate: z.string(),
        sdpMid: z.string().nullable().optional(),
        sdpMLineIndex: z.number().nullable().optional(),
        usernameFragment: z.string().nullable().optional(),
      })
      .nullable(),
  }),
]);
export type SignalPayload = z.infer<typeof signalPayloadSchema>;

// ---------------------------------------------------------------------------
// Клиент -> сервер
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    /** Гостевой или пользовательский JWT, выданный POST /api/join. */
    token: z.string().min(1),
  }),
  z.object({ type: z.literal("leave") }),
  z.object({
    type: z.literal("signal"),
    to: userIdSchema,
    payload: signalPayloadSchema,
  }),
  z.object({
    type: z.literal("state"),
    muted: z.boolean().optional(),
    deafened: z.boolean().optional(),
    speaking: z.boolean().optional(),
  }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Сервер -> клиент
// ---------------------------------------------------------------------------

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    selfId: userIdSchema,
    channelId: z.string(),
    channelName: z.string(),
    /**
     * Токен для переподключения. Живёт заметно дольше входного и нужен ровно
     * потому, что входной короткий: ушли с Wi-Fi на LTE, вернулись через пять
     * минут — по исходному токену войти уже нельзя.
     */
    resumeToken: z.string(),
    /** Это повторный вход той же сессии, а не первое появление в канале. */
    resumed: z.boolean(),
    /** Снимок комнаты на момент входа, БЕЗ самого вошедшего. */
    participants: z.array(participantSchema),
    iceServers: z.array(
      z.object({
        urls: z.union([z.string(), z.array(z.string())]),
        username: z.string().optional(),
        credential: z.string().optional(),
      }),
    ),
  }),
  z.object({ type: z.literal("peer_joined"), participant: participantSchema }),
  z.object({ type: z.literal("peer_left"), userId: userIdSchema }),
  /**
   * Участник вернулся после обрыва сигналинга.
   *
   * Его соединение с нами могло остаться наполовину собранным: наш offer ушёл
   * в мёртвый сокет, а встречный он отвергнет как коллизию — и пара залипнет
   * навсегда. Получив это, нужно проверить своё соединение с ним и пересобрать,
   * если оно нерабочее.
   */
  z.object({ type: z.literal("peer_resumed"), userId: userIdSchema }),
  z.object({
    type: z.literal("signal"),
    from: userIdSchema,
    payload: signalPayloadSchema,
  }),
  z.object({
    type: z.literal("peer_state"),
    userId: userIdSchema,
    muted: z.boolean().optional(),
    deafened: z.boolean().optional(),
    speaking: z.boolean().optional(),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "bad_token",
      "channel_not_found",
      "channel_full",
      "bad_message",
      "already_joined",
      "not_joined",
    ]),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * Кто в паре "вежливый" в терминах perfect negotiation.
 *
 * Без стабильного разделения ролей одновременный вход двух участников даёт glare:
 * оба шлют offer, оба откатываются, соединение виснет на "Подключаюсь". Сравнение
 * идентификаторов даёт одинаковый ответ на обеих сторонах без единой строчки
 * дополнительного согласования.
 */
export function isPolite(selfId: string, peerId: string): boolean {
  return selfId > peerId;
}
