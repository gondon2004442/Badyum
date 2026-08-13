import type { Attachment, ChatMessage, Participant } from "@badyum/shared";
import type { ScreenShare } from "./MeshEngine.ts";

export type { ScreenShare };

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
  /**
   * Работает ли RNNoise прямо сейчас.
   *
   * Это факт, а не настройка: переключатель может стоять в «вкл», а шумодав
   * не подняться — не загрузился wasm, старый браузер. Интерфейс показывает
   * именно это поле, иначе он обещал бы чистый звук, которого нет.
   */
  denoised: boolean;
  /** Показываем ли экран прямо сейчас. */
  sharing: boolean;
}

export interface JoinOptions {
  token: string;
  inputDeviceId?: string;
  /**
   * Брать ли микрофон.
   *
   * `false` — вход только ради переписки: сокет подключается, история и
   * присутствие работают, но микрофон не запрашивается и соединений с
   * собеседниками не возникает. Нужно, чтобы открытие личной переписки не
   * спрашивало разрешение на микрофон у человека, который просто хочет
   * написать.
   */
  withVoice?: boolean;
  /**
   * Включать ли RNNoise в исходящем тракте. По умолчанию да: без него
   * собеседники слышат вентилятор и клавиатуру, а это и есть игровой сценарий.
   */
  denoise?: boolean;
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
/** Кто сейчас набирает сообщение. */
export interface TypingPeer {
  userId: string;
  displayName: string;
}

export interface VoiceEngine {
  join(options: JoinOptions): Promise<void>;
  leave(): Promise<void>;

  setMuted(muted: boolean): void;
  setDeafened(deafened: boolean): void;
  /** Push-to-talk: то же, что мьют, но без записи в "пользователь замьючен". */
  setTransmitting(on: boolean): void;
  setInputDevice(deviceId: string): Promise<void>;
  /**
   * Включить или выключить шумодав, не выходя из разговора.
   *
   * Пересобирает исходящий тракт и подменяет дорожку у собеседников — эффект
   * слышен сразу. Настройка, которая «вступит в силу при следующем входе»,
   * выглядела бы сломанной.
   */
  setDenoise(on: boolean): Promise<void>;
  /** Локальная громкость конкретного участника, 0..2. */
  setParticipantVolume(userId: string, volume: number): void;

  /**
   * Демонстрация экрана.
   *
   * Живёт в движке по тому же правилу, что и всё медиа: экран — это ещё одна
   * дорожка в тех же соединениях, и компонент про них знать не должен. Начало
   * показа открывает системный диалог выбора окна, поэтому звать можно только
   * из обработчика нажатия.
   */
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  /** Чужие экраны. Их может быть несколько: запрета показывать вдвоём нет. */
  onScreens(cb: (who: ScreenShare[]) => void): Unsub;

  /**
   * Текстовый чат канала.
   *
   * Живёт здесь, а не в компоненте: сообщения приходят по тому же сокету, что
   * и состав комнаты, и должны переживать переподключение вместе с ним.
   */
  /** Отправить сообщение. Текст может быть пустым, если есть вложение. */
  sendChat(text: string, attachment?: Attachment): void;
  /**
   * Положить файл в хранилище и получить его описание.
   *
   * Загрузка живёт в движке, а не в компоненте, по тому же правилу, что и всё
   * остальное: экран не знает про транспорт. Заодно только движок и знает
   * токен, которым мы представляемся каналу.
   */
  uploadFile(file: File, size?: { width: number; height: number }): Promise<Attachment>;
  onChat(cb: (messages: ChatMessage[]) => void): Unsub;

  /** «Печатает…»: флаг, а не событие на нажатие — см. протокол. */
  setTyping(typing: boolean): void;
  onTyping(cb: (who: TypingPeer[]) => void): Unsub;

  /** Сменить имя, не выходя из канала. */
  rename(displayName: string): void;

  onParticipants(cb: (participants: VoiceParticipant[]) => void): Unsub;
  onSelf(cb: (self: SelfState) => void): Unsub;
  onQuality(cb: (quality: ConnectionQuality) => void): Unsub;
  onError(cb: (error: { code: string; message: string }) => void): Unsub;
}
