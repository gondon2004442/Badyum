import { DurableObject } from "cloudflare:workers";
import {
  presenceClientSchema,
  type Caller,
  type PresenceServerMessage,
} from "@badyum/shared";
import { Friends } from "./friends.ts";
import type { Env } from "./env.ts";

/**
 * Что мы знаем о сокете.
 *
 * Как и в комнате, живёт в attachment, а не в поле класса: при гибернации
 * объект выгружается, сокеты остаются, и восстановить, кто на том конце,
 * можно только отсюда.
 *
 * Здесь же лежит и текущий звонок. Дозвон длится десятки секунд полного
 * молчания — ровно то, при чём объект и засыпает; храни мы звонок в памяти,
 * он бы исчезал ровно тогда, когда нужен.
 */
interface Attached {
  who: Caller;
  call: {
    id: string;
    /** Второй участник. */
    peerId: string;
    /** Инвайт канала, созданного под этот звонок. */
    code: string;
    role: "caller" | "callee";
  } | null;
}

/**
 * Присутствие и личные звонки.
 *
 * Один объект на весь сервис: чтобы узнать, в сети ли друг, надо смотреть в
 * одно место. Разложить людей по объектам можно было бы только заранее зная,
 * кто с кем дружит, а дружба меняется.
 *
 * Сам разговор сюда не попадает: приняли звонок — оба заходят в обычный канал,
 * и дальше работает то же, что и всегда. Этот объект только сводит двоих.
 */
export class Presence extends DurableObject<Env> {
  private readonly friends: Friends;
  /**
   * Очередь разбора.
   *
   * Обработчики ходят в D1, а input gate упорядочивает только хранилище
   * объекта. Без очереди два быстрых сообщения от одного человека могли бы
   * перемешаться на await — «принять» обогнало бы «позвонить».
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.friends = new Friends(env.DB);

    // Ping и pong обслуживает платформа, не будя объект. Соединение висит всё
    // время, пока открыт сайт, и без этого heartbeat каждого вошедшего
    // съедал бы дневной лимит запросов на пустом месте.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Соединения
  // ---------------------------------------------------------------------------

  private sockets(): { ws: WebSocket; state: Attached }[] {
    const out: { ws: WebSocket; state: Attached }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as Attached | null;
      if (state) out.push({ ws, state });
    }
    return out;
  }

  private find(userId: string): { ws: WebSocket; state: Attached } | undefined {
    return this.sockets().find((s) => s.state.who.userId === userId);
  }

  private send(ws: WebSocket, msg: PresenceServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Сокет уже закрыт — не повод ронять обработку остальных.
    }
  }

  private update(ws: WebSocket, patch: Partial<Attached>): Attached | null {
    const current = ws.deserializeAttachment() as Attached | null;
    if (!current) return null;
    const next = { ...current, ...patch };
    ws.serializeAttachment(next);
    return next;
  }

  /**
   * Вход.
   *
   * Кто пришёл, решает Worker по куке сессии и передаёт сюда заголовком.
   * Объект чужим словам о личности не верит: сокет открыт только тому, кого
   * уже опознали.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("нужен websocket", { status: 426 });
    }

    const raw = request.headers.get("x-badyum-user");
    if (!raw) return new Response("нет пользователя", { status: 401 });

    // Через base64, потому что заголовок обязан быть ASCII, а в имени бывает
    // кириллица. Обратно — обязательно через TextDecoder: atob возвращает
    // байты по одному символу, и «Борис» без этого превратился бы в кракозябры.
    const who = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))),
    ) as Caller;

    // Второе окно того же человека вытесняет первое. Иначе звонок ушёл бы в
    // одну из вкладок наугад, и человек слышал бы вызов там, куда не смотрит.
    this.find(who.userId)?.ws.close(1000, "открыто другое окно");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ who, call: null } satisfies Attached);

    // Снимок отдаём сразу: без него человек первые секунды видит всех
    // офлайн, а потом список дёргается.
    this.send(server, { type: "online", userIds: await this.onlineFriendsOf(who.userId) });
    await this.announce(who.userId, true);

    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    this.queue = this.queue
      .then(() => this.handle(ws, text))
      .catch((err) => console.error("ошибка разбора сообщения присутствия", err));
  }

  override webSocketClose(ws: WebSocket): void {
    this.queue = this.queue.then(() => this.drop(ws)).catch(() => {});
  }

  override webSocketError(ws: WebSocket): void {
    this.queue = this.queue.then(() => this.drop(ws)).catch(() => {});
  }

  private async drop(ws: WebSocket): Promise<void> {
    const state = ws.deserializeAttachment() as Attached | null;
    if (!state) return;
    ws.serializeAttachment(null);

    // Закрыл вкладку посреди дозвона — для второго это то же самое, что
    // «сбросил». Оставить его слушать гудки было бы хуже всего.
    if (state.call) this.endCall(state.call.peerId, state.call.id, "gone");

    await this.announce(state.who.userId, false);
  }

  // ---------------------------------------------------------------------------
  // Присутствие
  // ---------------------------------------------------------------------------

  private async onlineFriendsOf(userId: string): Promise<string[]> {
    const ids = new Set(await this.friends.idsOfFriends(userId));
    return this.sockets()
      .map((s) => s.state.who.userId)
      .filter((id) => ids.has(id));
  }

  /** Сообщить друзьям, что человек зашёл или ушёл. */
  private async announce(userId: string, online: boolean): Promise<void> {
    const ids = await this.friends.idsOfFriends(userId);
    for (const id of ids) {
      const target = this.find(id);
      if (target) this.send(target.ws, { type: "presence", userId, online });
    }
  }

  // ---------------------------------------------------------------------------
  // Разбор
  // ---------------------------------------------------------------------------

  private async handle(ws: WebSocket, text: string): Promise<void> {
    const state = ws.deserializeAttachment() as Attached | null;
    if (!state) return;

    const parsed = presenceClientSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return;
    const msg = parsed.data;

    switch (msg.type) {
      case "sync": {
        this.send(ws, {
          type: "online",
          userIds: await this.onlineFriendsOf(state.who.userId),
        });
        return;
      }

      case "call": {
        await this.startCall(ws, state, msg.to, msg.callId);
        return;
      }

      case "call_accept": {
        if (state.call?.id !== msg.callId || state.call.role !== "callee") return;

        const caller = this.find(state.call.peerId);
        // Позвавший успел уйти. Своё состояние всё равно чистим, иначе человек
        // останется «в звонке» навсегда.
        if (!caller) {
          this.update(ws, { call: null });
          this.send(ws, { type: "call_ended", callId: msg.callId, reason: "gone" });
          return;
        }

        this.send(caller.ws, {
          type: "call_accepted",
          callId: msg.callId,
          code: state.call.code,
        });
        this.send(ws, { type: "call_accepted", callId: msg.callId, code: state.call.code });

        // Звонок состоялся: дальше их держит канал, а не мы.
        this.update(ws, { call: null });
        this.update(caller.ws, { call: null });
        return;
      }

      case "call_end": {
        if (state.call?.id !== msg.callId) return;
        const { peerId, id, role } = state.call;

        this.update(ws, { call: null });
        // Кто нажал, тот и определяет слово: позвавший — «передумал»,
        // позванный — «отказался».
        this.endCall(peerId, id, role === "caller" ? "cancelled" : "declined");
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Звонок
  // ---------------------------------------------------------------------------

  private async startCall(
    ws: WebSocket,
    state: Attached,
    to: string,
    callId: string,
  ): Promise<void> {
    const fail = (reason: "offline" | "busy" | "not_friends") =>
      this.send(ws, { type: "call_ended", callId, reason });

    if (state.call) return fail("busy");

    // Друзья ли — спрашиваем базу, а не верим клиенту: иначе позвонить можно
    // было бы любому, чей идентификатор случайно узнал.
    const link = await this.friends.between(state.who.userId, to);
    if (link?.status !== "accepted") return fail("not_friends");

    const target = this.find(to);
    if (!target) return fail("offline");
    if (target.state.call) return fail("busy");

    // Канал под звонок заводит каталог — он же считает лимиты, и личный звонок
    // не должен быть лазейкой мимо них.
    const registry = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("global"));
    const created = await registry.createChannelFor(`u:${state.who.userId}`, {
      name: `${state.who.displayName} и ${target.state.who.displayName}`,
    });
    if (!created.ok) return fail("busy");

    const invite = await registry.createInvite(created.channel.id);
    const call = { id: callId, code: invite.code };

    this.update(ws, { call: { ...call, peerId: to, role: "caller" } });
    this.update(target.ws, { call: { ...call, peerId: state.who.userId, role: "callee" } });

    this.send(target.ws, {
      type: "call_incoming",
      callId,
      from: state.who,
      code: invite.code,
    });
    this.send(ws, { type: "call_ringing", callId, to: target.state.who, code: invite.code });
  }

  /** Прекратить звонок у второго участника и сказать почему. */
  private endCall(
    peerId: string,
    callId: string,
    reason: "declined" | "cancelled" | "gone",
  ): void {
    const peer = this.find(peerId);
    if (!peer || peer.state.call?.id !== callId) return;

    this.update(peer.ws, { call: null });
    this.send(peer.ws, { type: "call_ended", callId, reason });
  }
}
