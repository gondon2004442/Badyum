import { DurableObject } from "cloudflare:workers";
import {
  clientMessageSchema,
  CHAT_HISTORY_LIMIT,
  type ChatMessage,
  type Participant,
  type ServerMessage,
} from "@badyum/shared";
import { ChatLog, normalizeDisplayName, TokenSigner } from "@badyum/core";
import { CloudflareTurn, stunOnly } from "./turn.ts";
import type { Env } from "./env.ts";

const HISTORY_KEY = "history";
const MAX_PARTICIPANTS_DEFAULT = 8;

/**
 * Что мы знаем о сокете.
 *
 * Живёт не в памяти, а в attachment сокета: при гибернации объект выгружается,
 * а сокеты остаются, и восстановить состав комнаты можно только отсюда.
 * Держать его дополнительно в поле класса — значит завести второй источник
 * правды, который разъедется после первого же засыпания.
 */
interface Attached extends Participant {
  channelName: string;
  /** Исчезает ли канал вместе с последним вышедшим. Берётся из каталога. */
  ephemeral: boolean;
}

const toParticipant = (a: Attached): Participant => ({
  userId: a.userId,
  identityId: a.identityId,
  displayName: a.displayName,
  muted: a.muted,
  deafened: a.deafened,
  speaking: a.speaking,
});

/**
 * Голосовой канал.
 *
 * Один объект на канал: он и есть комната. Сервер не разбирает SDP и не видит
 * медиа — держит состав и пересылает конверты `signal` адресату.
 *
 * Гибернация включена намеренно: без неё объект оставался бы в памяти всё
 * время, пока открыт хоть один сокет, и тикал бы по счётчику длительности.
 */
export class ChannelRoom extends DurableObject<Env> {
  private readonly chat = new ChatLog();
  private readonly signer: TokenSigner;
  private readonly turn: CloudflareTurn | null;
  /**
   * Очередь разбора сообщений.
   *
   * Обработчик асинхронный — проверка токена уходит в WebCrypto. Input gate
   * Durable Objects упорядочивает только обращения к хранилищу, поэтому два
   * сообщения от одного сокета могли бы перемешаться на await: `signal`
   * обогнал бы `join`, и адресат получил бы конверт от того, кого ещё нет в
   * комнате.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.signer = new TokenSigner(env.BADYUM_TOKEN_SECRET);
    this.turn =
      env.BADYUM_CF_TURN_KEY_ID && env.BADYUM_CF_TURN_API_TOKEN
        ? new CloudflareTurn(env.BADYUM_CF_TURN_KEY_ID, env.BADYUM_CF_TURN_API_TOKEN)
        : null;

    /**
     * Ping и pong обслуживает сама платформа, не будя объект.
     *
     * Это не микрооптимизация: на бесплатном плане каждое сообщение считается
     * запросом, а heartbeat идёт постоянно у каждого участника. Без авто-ответа
     * молчащая комната из четырёх человек тратила бы суточный лимит впустую.
     */
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );

    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<ChatMessage[]>(HISTORY_KEY);
      if (stored) this.chat.hydrate(this.channelId(), stored);
    });
  }

  /** Все объекты именуются по channelId, поэтому имя объекта — и есть он. */
  private channelId(): string {
    return this.ctx.id.name ?? "";
  }

  private maxParticipants(): number {
    return Number(this.env.BADYUM_MAX_PARTICIPANTS ?? MAX_PARTICIPANTS_DEFAULT);
  }

  // ---------------------------------------------------------------------------
  // Состав комнаты
  // ---------------------------------------------------------------------------

  private sockets(): { ws: WebSocket; who: Attached }[] {
    const out: { ws: WebSocket; who: Attached }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as Attached | null;
      if (who) out.push({ ws, who });
    }
    return out;
  }

  private find(userId: string): { ws: WebSocket; who: Attached } | undefined {
    return this.sockets().find((s) => s.who.userId === userId);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Сокет уже закрыт — не повод ронять обработку остальных.
    }
  }

  private broadcast(msg: ServerMessage, exceptUserId?: string): void {
    for (const { ws, who } of this.sockets()) {
      if (who.userId === exceptUserId) continue;
      this.send(ws, msg);
    }
  }

  private saveHistory(): void {
    void this.ctx.storage.put(HISTORY_KEY, this.chat.history(this.channelId()));
  }

  // ---------------------------------------------------------------------------
  // Приём соединений
  // ---------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("нужен websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // acceptWebSocket, а не server.accept(): только так объект может засыпать,
    // не разрывая соединения.
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    this.queue = this.queue
      .then(() => this.handle(ws, text))
      .catch((err) => console.error("ошибка разбора сообщения", err));
  }

  override webSocketClose(ws: WebSocket): void {
    this.drop(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.drop(ws);
  }

  private drop(ws: WebSocket): void {
    const who = ws.deserializeAttachment() as Attached | null;
    if (!who) return;
    ws.serializeAttachment(null);

    this.chat.forget(who.userId);
    this.broadcast({ type: "peer_left", userId: who.userId }, who.userId);

    /**
     * Эфемерный канал живёт ровно пока в нём кто-то есть: пустую комнату чистим
     * целиком, иначе переписка случайных встреч висела бы в хранилище вечно.
     *
     * Личный канал пары — наоборот. Двое вышли, поговорив, и вернулись завтра:
     * переписка обязана быть на месте. Стирать её значило бы, что чат с
     * человеком каждый раз начинается с нуля — а ради него он и открывается.
     */
    if (who.ephemeral && this.sockets().length === 0) {
      this.chat.clear(this.channelId());
      void this.ctx.storage.deleteAll();
    }
  }

  // ---------------------------------------------------------------------------
  // Протокол
  // ---------------------------------------------------------------------------

  private async handle(ws: WebSocket, text: string): Promise<void> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return this.send(ws, { type: "error", code: "bad_message", message: "не JSON" });
    }

    const parsed = clientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return this.send(ws, {
        type: "error",
        code: "bad_message",
        message: "сообщение не соответствует протоколу",
      });
    }
    const msg = parsed.data;

    // Обычно на ping отвечает платформа, но если формат чуть иной — ответим сами.
    if (msg.type === "ping") return this.send(ws, { type: "pong" });

    if (msg.type === "join") return this.join(ws, msg.token);

    const who = ws.deserializeAttachment() as Attached | null;
    if (!who) {
      return this.send(ws, { type: "error", code: "not_joined", message: "сначала join" });
    }

    switch (msg.type) {
      case "signal": {
        // Адресная пересылка вслепую. Проверяем только что адресат в этой же
        // комнате — иначе канал стал бы способом слать что угодно кому угодно.
        const target = this.find(msg.to);
        if (!target) return;
        return this.send(target.ws, {
          type: "signal",
          from: who.userId,
          payload: msg.payload,
        });
      }

      case "state": {
        const next: Attached = {
          ...who,
          muted: msg.muted ?? who.muted,
          deafened: msg.deafened ?? who.deafened,
          speaking: msg.speaking ?? who.speaking,
        };
        // Оглохший не может говорить, замьюченный не может «говорить»: иначе у
        // остальных горит кольцо человека, которого они не слышат.
        if (next.deafened) next.muted = true;
        if (next.muted) next.speaking = false;
        ws.serializeAttachment(next);

        return this.broadcast(
          {
            type: "peer_state",
            userId: next.userId,
            muted: next.muted,
            deafened: next.deafened,
            speaking: next.speaking,
          },
          next.userId,
        );
      }

      case "typing": {
        // Отправителю не шлём: себе «печатает…» не показывают.
        return this.broadcast(
          {
            type: "peer_typing",
            userId: who.userId,
            displayName: who.displayName,
            typing: msg.typing,
          },
          who.userId,
        );
      }

      case "chat_send": {
        const result = this.chat.append(
          this.channelId(),
          { userId: who.userId, displayName: who.displayName },
          msg.text,
        );
        if (!result.ok) {
          if (result.error === "too_fast") {
            this.send(ws, {
              type: "error",
              code: "too_fast",
              message: "слишком часто — подожди пару секунд",
            });
          }
          return;
        }
        this.saveHistory();
        // Отправителю тоже: так у всех один порядок сообщений, а не «своё
        // сразу, чужое потом».
        return this.broadcast({ type: "chat_message", message: result.message });
      }

      case "rename": {
        const name = normalizeDisplayName(msg.displayName);
        if (!name || name === who.displayName) return;

        ws.serializeAttachment({ ...who, displayName: name });
        return this.broadcast({
          type: "peer_renamed",
          userId: who.userId,
          displayName: name,
        });
      }

      case "leave": {
        this.drop(ws);
        try {
          ws.close(1000, "вышел");
        } catch {
          // Уже закрыт.
        }
        return;
      }
    }
  }

  private async join(ws: WebSocket, token: string): Promise<void> {
    if (ws.deserializeAttachment()) {
      return this.send(ws, {
        type: "error",
        code: "already_joined",
        message: "сессия уже в канале",
      });
    }

    const claims = await this.signer.verify(token);
    if (!claims || claims.channelId !== this.channelId()) {
      return this.send(ws, {
        type: "error",
        code: "bad_token",
        message: "токен недействителен или истёк",
      });
    }

    const channel = await this.env.REGISTRY.get(
      this.env.REGISTRY.idFromName("global"),
    ).getChannel(claims.channelId);
    if (!channel) {
      return this.send(ws, {
        type: "error",
        code: "channel_not_found",
        message: "канала больше нет",
      });
    }

    /**
     * Возврат той же сессии.
     *
     * Телефон ушёл в сон или сеть моргнула — старый сокет остаётся зомби, и
     * заметить это можно лишь спустя десятки секунд. Всё это время человек не
     * смог бы вернуться: комната считает, что он всё ещё внутри. Поэтому вход
     * под уже присутствующим userId не ошибка, а перехват.
     */
    const previous = this.find(claims.userId);
    const resumed = previous !== undefined;

    if (!resumed && this.sockets().length >= this.maxParticipants()) {
      return this.send(ws, {
        type: "error",
        code: "channel_full",
        message: `в канале максимум ${this.maxParticipants()} человек`,
      });
    }

    const who: Attached = {
      userId: claims.userId,
      identityId: claims.identityId ?? null,
      displayName: claims.displayName,
      // Вошедший замьючен, пока сам не скажет обратное: иначе первые секунды он
      // вещает, не зная об этом.
      muted: previous?.who.muted ?? true,
      deafened: previous?.who.deafened ?? false,
      speaking: false,
      channelName: channel.name,
      ephemeral: channel.ephemeral,
    };
    ws.serializeAttachment(who);

    // Старый сокет обезличиваем до закрытия, иначе его webSocketClose выкинул
    // бы человека из комнаты, в которую он только что вернулся.
    if (previous) {
      previous.ws.serializeAttachment(null);
      try {
        previous.ws.close(1012, "перехват сессии");
      } catch {
        // Уже мёртв — этого мы и добивались.
      }
    }

    if (claims.inviteCode) {
      void this.env.REGISTRY.get(this.env.REGISTRY.idFromName("global")).consumeInvite(
        claims.inviteCode,
      );
    }

    const others = this.sockets()
      .filter((s) => s.who.userId !== claims.userId)
      .map((s) => toParticipant(s.who));

    this.send(ws, {
      type: "welcome",
      selfId: claims.userId,
      channelId: channel.id,
      channelName: channel.name,
      resumeToken: await this.signer.signResumeToken({
        userId: claims.userId,
        channelId: claims.channelId,
        identityId: claims.identityId ?? null,
        displayName: claims.displayName,
        inviteCode: null,
      }),
      resumed,
      participants: others,
      history: this.chat.history(this.channelId()).slice(-CHAT_HISTORY_LIMIT),
      iceServers: this.turn ? await this.turn.iceServers() : stunOnly(),
    });

    if (resumed) {
      // Второй peer_joined сбил бы остальных: для них человек и не уходил. Но
      // предупредить надо — у кого-то соединение с ним могло остаться
      // недостроенным, пока он был вне сети.
      this.broadcast({ type: "peer_resumed", userId: claims.userId }, claims.userId);
    } else {
      this.broadcast(
        { type: "peer_joined", participant: toParticipant(who) },
        claims.userId,
      );
    }
  }
}
