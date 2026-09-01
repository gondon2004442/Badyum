import {
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@badyum/shared";

type Listener = (msg: ServerMessage) => void;

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

/**
 * Сердцебиение.
 *
 * Без него пропажа сети не замечается вовсе. Когда связь исчезает не разрывом,
 * а тишиной — выдернули кабель, ушёл wi-fi, уснул роутер, — TCP не закрывается,
 * событие `close` не приходит, и сокет остаётся «открытым» навсегда. Человек
 * при этом видит рабочий экран и говорит в пустоту: проверено, шестьдесят
 * секунд offline не давали ни одного признака.
 *
 * Поэтому спрашиваем сами. Молчание дольше DEAD_AFTER_MS считаем обрывом и
 * дальше идём обычным путём переподключения — человек видит то же «связь
 * пропала», что и при честном разрыве.
 *
 * Интервалы выбраны из несимметричности цены ошибки. Опоздать — значит дать
 * человеку говорить в пустоту, и каждая секунда здесь идёт ему в убыток.
 * Ошибиться в другую сторону почти ничего не стоит: звук идёт напрямую между
 * браузерами и от сигналинга не зависит вовсе, а переподключение занимает
 * около секунды — проверено. Значит осторожничать незачем.
 *
 * Отсюда восемь секунд при пороге в двадцать: на обрыв надо пропустить два с
 * половиной ответа подряд — от случайной потери пакета это защищает, — а
 * замечаем мы его за двадцать-двадцать восемь секунд вместо сорока с лишним.
 * Частота при этом бесплатна: на ping отвечает сама платформа, не будя объект
 * канала, — см. ChannelRoom.
 */
const PING_EVERY_MS = 8_000;
const DEAD_AFTER_MS = 20_000;

/**
 * WebSocket к сигналингу с переподключением.
 *
 * Обрыв сигналинга сам по себе не рвёт звук: медиа идёт напрямую между
 * браузерами. Но без сигналинга мы перестаём узнавать о входящих и выходящих,
 * поэтому переподключаться надо молча и настойчиво, а не показывать ошибку.
 */
export class SignalingSocket {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly listeners = new Set<Listener>();
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private closedByUs = false;
  private pendingToken: string | null = null;
  private readonly stateSubs = new Set<(online: boolean) => void>();
  private heartbeat: number | null = null;
  /** Когда с той стороны в последний раз пришло хоть что-нибудь. */
  private lastSeen = 0;

  constructor(url: string) {
    this.url = url;
  }

  connect(token: string): void {
    this.pendingToken = token;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (this.socket) return;

    /**
     * Токен уходит и в адресе, и следом сообщением `join`.
     *
     * В адресе он нужен потому, что серверу надо выбрать комнату до того, как
     * придёт первое сообщение: соединение сразу отдаётся объекту канала целиком
     * и после апгрейда его уже не перенаправить. Сообщением — потому что именно
     * оно несёт вход, и обычный сервер знает только его.
     *
     * Токен живёт две минуты и не даёт прав сверх входа в конкретный канал, так
     * что попадание в логи прокси его не превращает в ключ от чего-либо.
     */
    const url = this.pendingToken
      ? `${this.url}${this.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.pendingToken)}`
      : this.url;

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      if (this.pendingToken) {
        this.send({ type: "join", token: this.pendingToken });
      }
      this.emitState(true);
      this.startHeartbeat();
    };

    socket.onmessage = (event) => {
      // Отметку живости ставим до разбора: важен сам факт, что с той стороны
      // говорят. Ответ на ping — это pong, который дальше никого не заинтересует
      // и будет отброшен разбором, а как признак жизни он полноценный.
      this.lastSeen = Date.now();

      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = serverMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const listener of this.listeners) listener(parsed.data);
    };

    socket.onclose = () => this.lost(socket);

    socket.onerror = () => {
      socket.close();
    };
  }

  /**
   * Связь потеряна: снимаемся с этого сокета и начинаем сначала.
   *
   * Не «закрыть и ждать onclose», а именно объявить самим. Проверено живьём:
   * `close()` на соединении без сети переводит сокет в CLOSING и оставляет его
   * там навсегда — закрывающее рукопожатие некому подтвердить, а таймаута на
   * этот случай у браузера нет. Через минуту после вызова readyState всё ещё 2,
   * а `onclose` не пришёл ни разу. Дожидаться его значит не сказать человеку
   * ничего вообще — ровно та поломка, ради которой всё это и делается.
   *
   * Одна точка на оба повода — и на честный `onclose`, и на молчание, — чтобы
   * «что значит потеря связи» знало ровно одно место. Повторный вызов для
   * одного и того же сокета безвреден: сверяемся с тем, что он всё ещё наш.
   */
  private lost(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.stopHeartbeat();

    // Обработчики снимаем: поздний onclose от уже забытого сокета устроил бы
    // второе переподключение поверх идущего.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // Уже не наш и никого не держит.
    }

    if (this.closedByUs) return;
    this.emitState(false);
    this.scheduleReconnect();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastSeen = Date.now();

    this.heartbeat = window.setInterval(() => {
      const socket = this.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;

      if (Date.now() - this.lastSeen > DEAD_AFTER_MS) {
        this.lost(socket);
        return;
      }

      this.send({ type: "ping" });
    }, PING_EVERY_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    window.clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;

    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Токен, которым представляемся при следующем переподключении.
   *
   * Входной токен живёт две минуты — он не пережил бы даже поездку в лифте.
   * Как только сервер прислал resume-токен, дальше пользуемся им.
   */
  useResumeToken(token: string): void {
    this.pendingToken = token;
  }

  /**
   * Токен, которым мы сейчас представляемся каналу.
   *
   * Нужен загрузке вложений: она идёт обычным HTTP мимо сокета, но право на
   * неё то же самое — «я в этом канале». Отдельный токен ради этого выдавать
   * незачем, а без права ручка складывала бы в бакет что угодно кто угодно.
   */
  currentToken(): string | null {
    return this.pendingToken;
  }

  onConnectionState(listener: (online: boolean) => void): () => void {
    this.stateSubs.add(listener);
    return () => this.stateSubs.delete(listener);
  }

  private emitState(online: boolean): void {
    for (const listener of this.stateSubs) listener(online);
  }

  close(): void {
    this.closedByUs = true;
    this.pendingToken = null;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
    this.stateSubs.clear();
  }
}
