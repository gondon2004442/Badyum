import type { ChatMessage, Participant } from "@badyum/shared";

export type Unsub = () => void;

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface ConnectionQuality {
  status: ConnectionStatus;
  /** Round-trip в миллисекундах, null пока не измерен. */
  rttMs: number | null;
  /** Доля потерянных пакетов 0..1. */
  packetLoss: number | null;
  /** Идёт ли медиа через TURN-relay. Полезно понимать при разборе жалоб. */
  relayed: boolean;
}

export interface VoiceParticipant extends Participant {
  /** Локальная громкость этого участника, 0..2. Не уходит на сервер. */
  volume: number;
  /** Есть ли живой входящий аудиопоток. */
  hasStream: boolean;
}

export interface SelfState {
  /** Кто мы в этой сессии. Нужен, чтобы отличить свои сообщения от чужих. */
  selfId: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  /**
   * Идёт ли передача прямо сейчас. Отличается от `muted`: при включённой рации
   * микрофон не выключен, но и не передаёт, пока клавиша не зажата. Без этого
   * состояния в интерфейсе человек не понимает, слышат его или нет.
   */
  transmitting: boolean;
}

export interface JoinOptions {
  token: string;
  inputDeviceId?: string;
}

/**
 * Единственный контракт между UI и транспортом звука.
 *
 * Mesh и SFU отличаются ровно одним: откуда берутся медиапотоки. Всё остальное —
 * состав комнаты, индикация речи, мьюты, громкости — одинаково. Поэтому UI
 * разговаривает только с этим интерфейсом, и переезд на SFU не трогает экраны.
 *
 * Правило: ни один React-компонент не импортирует RTCPeerConnection напрямую.
 */
export interface VoiceEngine {
  join(options: JoinOptions): Promise<void>;
  leave(): Promise<void>;

  setMuted(muted: boolean): void;
  setDeafened(deafened: boolean): void;
  /** Push-to-talk: то же, что мьют, но без записи в "пользователь замьючен". */
  setTransmitting(on: boolean): void;
  setInputDevice(deviceId: string): Promise<void>;
  /** Локальная громкость конкретного участника, 0..2. */
  setParticipantVolume(userId: string, volume: number): void;

  /**
   * Текстовый чат канала.
   *
   * Живёт здесь, а не в компоненте: сообщения приходят по тому же сокету, что
   * и состав комнаты, и должны переживать переподключение вместе с ним.
   */
  sendChat(text: string): void;
  onChat(cb: (messages: ChatMessage[]) => void): Unsub;

  onParticipants(cb: (participants: VoiceParticipant[]) => void): Unsub;
  onSelf(cb: (self: SelfState) => void): Unsub;
  onQuality(cb: (quality: ConnectionQuality) => void): Unsub;
  onError(cb: (error: { code: string; message: string }) => void): Unsub;
}
