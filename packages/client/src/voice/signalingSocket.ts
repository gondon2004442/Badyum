import {
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@badyum/shared";

type Listener = (msg: ServerMessage) => void;

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

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
    };

    socket.onmessage = (event) => {
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

    socket.onclose = () => {
      this.socket = null;
      if (this.closedByUs) return;
      this.emitState(false);
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
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
