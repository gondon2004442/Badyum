import {
  ATTACHMENT_MAX_BYTES,
  TYPING_REFRESH_MS,
  TYPING_TTL_MS,
  type Attachment,
  type ChatMessage,
  type Participant,
  type SignalPayload,
} from "@badyum/shared";
import type {
  ConnectionQuality,
  JoinOptions,
  SelfState,
  Unsub,
  TypingPeer,
  VoiceEngine,
  VoiceParticipant,
} from "./VoiceEngine.ts";
import { Peer } from "./peer.ts";
import { SignalingSocket } from "./signalingSocket.ts";
import { Mixer } from "./audio/mixer.ts";
import { createVad, type VadHandle } from "./audio/vad.ts";
import { createAudioContext } from "./audio/devices.ts";
import { createMicPipeline, type MicPipeline } from "./audio/micPipeline.ts";
import { keepAwake, type WakeHandle } from "./audio/wake.ts";
import { apiOrigin } from "../api.ts";
import { UploadError } from "./uploadError.ts";
import { bitrateFor, captureScreen } from "./screen.ts";

const STATS_INTERVAL_MS = 3000;

/** Чужой показ экрана: кто показывает и что именно. */
export interface ScreenShare {
  userId: string;
  displayName: string;
  stream: MediaStream;
}

/**
 * P2P mesh: с каждым собеседником отдельное соединение.
 *
 * Честная граница применимости — примерно до 6 человек. Дальше исходящий поток
 * растёт линейно с числом участников (каждому шлём свою копию), и upstream
 * домашнего интернета кончается раньше, чем терпение. Именно поэтому
 * существует VoiceEngine: замена этого класса на SfuEngine не трогает UI.
 */
export class MeshEngine implements VoiceEngine {
  private readonly socket: SignalingSocket;

  private context: AudioContext | null = null;
  private mixer: Mixer | null = null;
  /**
   * Исходящий тракт целиком. `localStream` — его выход, тот самый поток,
   * который уходит собеседникам; при включённом шумодаве это уже не микрофон.
   */
  private mic: MicPipeline | null = null;
  /**
   * Сторож аудиоконтекста.
   *
   * Браузер на телефоне усыпляет контекст, стоит вкладке уйти в фон — например,
   * когда открывают галерею, чтобы приложить картинку. Сам он не просыпается, а
   * через него идёт весь звук: и входящий, и исходящий.
   */
  private wake: WakeHandle | null = null;
  private localStream: MediaStream | null = null;
  private vad: VadHandle | null = null;

  /** Что нужно, чтобы пересобрать тракт на ходу: устройство и шумодав. */
  private inputDeviceId: string | undefined;
  private denoisePref = true;
  private denoised = false;

  private selfId: string | null = null;
  private readonly peers = new Map<string, Peer>();
  private readonly participants = new Map<string, VoiceParticipant>();

  /**
   * Входим замьюченными.
   *
   * Иначе первые секунды в канале человек вещает, не зная об этом: остальные
   * слышат его комнату, клавиатуру и разговор, который к ним не относился.
   * Обратная опасность — «меня не слышат, всё сломалось» — снимается тем, что
   * выключенный микрофон явно виден в UI, а не только по отсутствию звука.
   */
  private muted = true;
  private deafened = false;
  private speaking = false;
  /** Push-to-talk: false означает «сейчас не передаём», но мьют не выставлен. */
  private transmitting = true;

  private quality: ConnectionQuality = {
    status: "idle",
    rttMs: null,
    packetLoss: null,
    relayed: false,
  };
  private iceServers: RTCIceServer[] = [];
  private statsTimer: number | null = null;

  private readonly participantsSubs = new Set<(p: VoiceParticipant[]) => void>();
  private readonly selfSubs = new Set<(s: SelfState) => void>();
  private readonly qualitySubs = new Set<(q: ConnectionQuality) => void>();
  private readonly errorSubs = new Set<(e: { code: string; message: string }) => void>();
  private readonly chatSubs = new Set<(m: ChatMessage[]) => void>();
  private readonly typingSubs = new Set<(who: TypingPeer[]) => void>();

  /** Кто сейчас печатает. Таймер снимает надпись, если подтверждение не пришло. */
  private readonly typing = new Map<
    string,
    { displayName: string; timer: number }
  >();
  /** Когда мы в последний раз сообщили о своём наборе — для троттлинга. */
  private typingSentAt = 0;

  /** Переписка канала. Переживает переподключение вместе с сокетом. */
  private messages: ChatMessage[] = [];

  /** Наш экран, пока мы его показываем. */
  private screen: MediaStream | null = null;
  /** Чужие экраны: userId → поток. */
  private readonly screens = new Map<string, MediaStream>();
  private readonly screenSubs = new Set<(who: ScreenShare[]) => void>();

  constructor(wsUrl: string) {
    this.socket = new SignalingSocket(wsUrl);
  }

  async join({
    token,
    inputDeviceId,
    withVoice = true,
    denoise = true,
  }: JoinOptions): Promise<void> {
    this.setQuality({ status: "connecting" });
    this.inputDeviceId = inputDeviceId;
    this.denoisePref = denoise;

    /**
     * Без голоса — вход только ради переписки.
     *
     * Микрофон не запрашиваем и звуковой граф не поднимаем: человек, который
     * зашёл написать сообщение, не должен видеть запрос разрешения. Соединений
     * с собеседниками при этом не возникает само собой — createPeer выходит,
     * пока нет локального потока.
     */
    if (withVoice) {
      // Контекст поднимаем первым, а не после микрофона, как было раньше: на
      // iOS resume() обязан случиться внутри пользовательского жеста, и каждый
      // await до него — это шанс, что жест уже «протух». Заодно шумодаву нужен
      // готовый контекст, чтобы зарегистрировать в нём worklet.
      this.context = createAudioContext();
      await this.context.resume();
      this.wake = keepAwake(this.context);

      // Микрофон берём до сигналинга: отказ в правах должен быть виден сразу,
      // а не после того, как мы уже показались остальным в канале.
      this.mic = await createMicPipeline(this.context, inputDeviceId, denoise);
      this.localStream = this.mic.stream;
      this.denoised = this.mic.denoised;
      // Глушим дорожку сразу, не дожидаясь первого setMuted: между захватом
      // микрофона и подключением проходят сотни миллисекунд живого звука.
      this.applyTrackState();

      this.mixer = new Mixer(this.context);

      this.attachVad();
    }

    this.socket.on((msg) => this.handleServerMessage(msg));

    // Обрыв сигналинга сам по себе не рвёт звук, но состав канала мы больше не
    // узнаём — и молчать об этом нельзя, иначе тишина выглядит поломкой.
    this.socket.onConnectionState((online) => {
      if (!online) this.setQuality({ status: "reconnecting" });
    });

    this.socket.connect(token);

    this.statsTimer = window.setInterval(() => void this.pollStats(), STATS_INTERVAL_MS);
  }

  async leave(): Promise<void> {
    this.socket.send({ type: "leave" });
    this.socket.close();

    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.participants.clear();
    this.messages = [];
    this.emitChat();

    this.wake?.stop();
    this.wake = null;

    // Показ прекращаем явно: иначе браузер оставит гореть индикатор «идёт
    // запись экрана» после того, как человек уже вышел из канала.
    for (const track of this.screen?.getTracks() ?? []) track.stop();
    this.screen = null;
    this.screens.clear();
    this.emitScreens();

    this.vad?.stop();
    this.vad = null;

    this.mixer?.destroy();
    this.mixer = null;

    // Отпускает и микрофон, и всё, что стоит за ним в графе. Останавливать
    // дорожки localStream напрямую было бы недостаточно: при включённом
    // шумодаве это выход MediaStreamDestination, а не сам микрофон, и
    // индикатор записи в браузере горел бы после выхода из канала.
    this.mic?.stop();
    this.mic = null;
    this.localStream = null;
    this.denoised = false;

    await this.context?.close();
    this.context = null;
    this.selfId = null;

    this.setQuality({ status: "idle", rttMs: null, packetLoss: null, relayed: false });
    this.emitParticipants();
  }

  // -------------------------------------------------------------------------
  // Управление
  // -------------------------------------------------------------------------

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) this.deafened = false;
    this.applyTrackState();
    this.socket.send({ type: "state", muted: this.muted, deafened: this.deafened });
    this.emitSelf();
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    // Оглохнуть и продолжать говорить — состояние, которого никто не ожидает.
    if (deafened) this.muted = true;
    this.mixer?.setDeafened(deafened);
    this.applyTrackState();
    this.socket.send({ type: "state", muted: this.muted, deafened: this.deafened });
    this.emitSelf();
  }

  setTransmitting(on: boolean): void {
    if (this.transmitting === on) return;
    this.transmitting = on;
    this.applyTrackState();
    this.emitSelf();
  }

  async setInputDevice(deviceId: string): Promise<void> {
    // Пустая строка в списке — это «по умолчанию», а не устройство с пустым id.
    this.inputDeviceId = deviceId || undefined;
    await this.rebuildMic();
  }

  async setDenoise(on: boolean): Promise<void> {
    if (this.denoisePref === on) return;
    this.denoisePref = on;
    await this.rebuildMic();
  }

  /**
   * Пересобрать исходящий тракт, не разрывая разговор.
   *
   * Смена микрофона и переключение шумодава делают одно и то же: на выходе
   * появляется новая дорожка. Отдаём её живым соединениям через replaceTrack —
   * пересогласование здесь означало бы разрыв звука у всех разом.
   *
   * Новый тракт собираем до того, как трогаем старый: если микрофон занят или
   * wasm не отдался, разговор должен продолжиться на том, что уже работает.
   */
  private async rebuildMic(): Promise<void> {
    // Зашли переписываться — тракта нет вовсе, и пересобирать нечего.
    if (!this.context) return;

    const next = await createMicPipeline(
      this.context,
      this.inputDeviceId,
      this.denoisePref,
    );

    await Promise.all(
      [...this.peers.values()].map((peer) => peer.replaceAudioTrack(next.track)),
    );

    const previous = this.mic;
    this.mic = next;
    this.localStream = next.stream;
    this.denoised = next.denoised;
    this.applyTrackState();

    this.vad?.stop();
    this.attachVad();

    previous?.stop();
    this.emitSelf();
  }

  /**
   * Начать показывать экран.
   *
   * Системный диалог выбора окна открывается первым: пока человек не выбрал,
   * рассказывать остальным нечего, а флаг «показывает», выставленный заранее,
   * пришлось бы снимать при каждом «Отмена».
   */
  async startScreenShare(): Promise<void> {
    if (this.screen) return;

    const stream = await captureScreen();
    this.screen = stream;

    /*
      Показ прекращают двумя способами: нашей кнопкой и системной плашкой
      «Остановить доступ» внизу экрана. Вторая нам ничего не сообщает — только
      обрывает дорожку. Без этой подписки у остальных остался бы висеть
      замерший кадр и надпись «показывает».
    */
    const video = stream.getVideoTracks()[0];
    video?.addEventListener("ended", () => void this.stopScreenShare());

    const share = bitrateFor(this.peers.size);
    await Promise.all([...this.peers.values()].map((peer) => peer.addScreen(stream, share)));

    this.socket.send({ type: "state", sharing: true });
    this.emitSelf();
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screen) return;

    for (const peer of this.peers.values()) peer.stopScreen();
    for (const track of this.screen.getTracks()) track.stop();
    this.screen = null;

    this.socket.send({ type: "state", sharing: false });
    this.emitSelf();
  }

  onScreens(cb: (who: ScreenShare[]) => void): Unsub {
    this.screenSubs.add(cb);
    cb(this.screenList());
    return () => this.screenSubs.delete(cb);
  }

  private addScreenOf(userId: string, stream: MediaStream): void {
    this.screens.set(userId, stream);

    // Собеседник закрыл показ — поток обрывается, и кадр надо убрать. Иначе
    // на экране навсегда останется последняя картинка того, что уже не идёт.
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => this.dropScreenOf(userId));
    }

    this.emitScreens();
  }

  private dropScreenOf(userId: string): void {
    if (!this.screens.delete(userId)) return;
    this.emitScreens();
  }

  private screenList(): ScreenShare[] {
    return [...this.screens.entries()].map(([userId, stream]) => ({
      userId,
      displayName: this.participants.get(userId)?.displayName ?? "участник",
      stream,
    }));
  }

  private emitScreens(): void {
    const list = this.screenList();
    for (const cb of this.screenSubs) cb(list);
  }

  /**
   * Пересчитать потолок на каждого зрителя.
   *
   * Зовётся при изменении состава: поток копируется каждому, и вошедший
   * третий должен уменьшить долю остальных, а не добавиться сверху.
   */
  private async rebalanceScreen(): Promise<void> {
    if (!this.screen) return;
    const share = bitrateFor(this.peers.size);
    await Promise.all(
      [...this.peers.values()].map((peer) => peer.setScreenBitrate(share)),
    );
  }

  setParticipantVolume(userId: string, volume: number): void {
    this.mixer?.setVolume(userId, volume);
    const participant = this.participants.get(userId);
    if (participant) {
      participant.volume = this.mixer?.getVolume(userId) ?? volume;
      this.emitParticipants();
    }
  }

  /**
   * Мьют и push-to-talk — это `track.enabled`, а не пересогласование.
   * Переключение мгновенное и не трогает соединение.
   */
  private applyTrackState(): void {
    const shouldSend = !this.muted && this.transmitting;
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = shouldSend;
    }
    if (!shouldSend && this.speaking) {
      this.speaking = false;
      this.socket.send({ type: "state", speaking: false });
      this.emitSelf();
    }
  }

  private attachVad(): void {
    if (!this.context || !this.mic) return;

    // Слушаем выход тракта, а не микрофон: кольцо должно загораться от того,
    // что слышат остальные. Мьют при этом граф не глушит — он выключает только
    // исходящую дорожку, — поэтому «говорит» ниже считается с оглядкой на него.
    this.vad = createVad(this.context, this.mic.analysis, (speaking) => {
      // Замьюченный не может «говорить»: иначе у остальных горит кольцо
      // человека, которого они не слышат.
      const effective = speaking && !this.muted && this.transmitting;
      if (effective === this.speaking) return;
      this.speaking = effective;
      this.socket.send({ type: "state", speaking: effective });
      this.emitSelf();
    });
  }

  // -------------------------------------------------------------------------
  // Сигналинг
  // -------------------------------------------------------------------------

  private handleServerMessage(msg: import("@badyum/shared").ServerMessage): void {
    switch (msg.type) {
      case "welcome": {
        this.selfId = msg.selfId;
        this.iceServers = msg.iceServers as RTCIceServer[];
        // Дальше переподключаемся по нему: входной токен живёт две минуты.
        this.socket.useResumeToken(msg.resumeToken);

        const present = new Set(msg.participants.map((p) => p.userId));

        // Пока сигналинг лежал, кто-то мог уйти. Медиа с ним уже мёртвое.
        for (const [userId, peer] of this.peers) {
          if (present.has(userId)) continue;
          peer.close();
          this.peers.delete(userId);
          this.mixer?.remove(userId);
        }
        for (const userId of [...this.participants.keys()]) {
          if (!present.has(userId)) this.participants.delete(userId);
        }

        for (const participant of msg.participants) {
          this.upsertParticipant(participant);

          // Соединение создаём только если его ещё нет. При возврате живые
          // peer-соединения не трогаем: медиа идёт напрямую и обрыв сигналинга
          // переживает. А вот с теми, кто вошёл, пока мы были offline, связи
          // нет — их offer ушёл в мёртвый сокет, и инициировать должны мы.
          // Без микрофона соединяться нечем и незачем: мы зашли переписываться.
          if (this.localStream && !this.peers.has(participant.userId)) {
            this.createPeer(participant.userId);
          }
        }

        // Показ переживает обрыв сигналинга у тех, с кем медиа осталось живо;
        // с остальными соединение пересобрано выше, и экран им отдаст createPeer.

        // История заменяет локальную целиком: сервер — источник правды и
        // порядка, иначе после возврата сообщения задваивались бы.
        this.messages = msg.history;
        this.emitChat();

        this.setQuality({ status: "connected" });
        this.emitParticipants();
        this.emitSelf();
        return;
      }

      case "peer_joined": {
        this.upsertParticipant(msg.participant);
        // Соединение создаст он сам — иначе получим два offer навстречу.
        this.emitParticipants();
        return;
      }

      case "peer_resumed": {
        const peer = this.peers.get(msg.userId);

        // Медиа идёт напрямую и переживает обрыв сигналинга. Если соединение
        // живо — трогать его нельзя, пересборка оборвала бы работающий звук.
        if (peer && peer.isConnected()) return;

        // Иначе оно недостроено: наш offer ушёл в никуда, пока он был offline.
        // Пересобираем начисто — иначе пара залипнет навсегда.
        peer?.close();
        this.peers.delete(msg.userId);
        this.mixer?.remove(msg.userId);

        const participant = this.participants.get(msg.userId);
        if (participant) participant.hasStream = false;

        if (this.localStream) this.createPeer(msg.userId);
        this.emitParticipants();
        return;
      }

      case "peer_left": {
        this.peers.get(msg.userId)?.close();
        this.peers.delete(msg.userId);
        this.mixer?.remove(msg.userId);
        this.participants.delete(msg.userId);
        this.dropScreenOf(msg.userId);
        // Зрителей стало меньше — оставшимся можно отдать больше.
        void this.rebalanceScreen();
        this.emitParticipants();
        return;
      }

      case "signal": {
        // Зашли переписываться — отвечать на предложение соединения нечем:
        // микрофона нет. Молча пропускаем, а не падаем: для того, кто читает
        // чат, чужая попытка соединиться не событие.
        if (!this.localStream) return;

        const peer = this.peers.get(msg.from) ?? this.createPeer(msg.from);
        void peer.acceptSignal(msg.payload);
        return;
      }

      case "peer_state": {
        const participant = this.participants.get(msg.userId);
        if (!participant) return;
        if (msg.muted !== undefined) participant.muted = msg.muted;
        if (msg.deafened !== undefined) participant.deafened = msg.deafened;
        if (msg.speaking !== undefined) participant.speaking = msg.speaking;
        if (msg.sharing !== undefined) {
          participant.sharing = msg.sharing;
          // Флаг снят — значит поток уже не придёт, и ждать нечего. Событие
          // `ended` на дорожке приходит не всегда: при обрыве соединения его
          // не будет вовсе, и замерший кадр остался бы висеть.
          if (!msg.sharing) this.dropScreenOf(msg.userId);
        }
        this.emitParticipants();
        return;
      }

      case "error": {
        for (const cb of this.errorSubs) cb({ code: msg.code, message: msg.message });
        if (msg.code === "bad_token" || msg.code === "channel_not_found") {
          this.setQuality({ status: "failed" });
        }
        return;
      }

      case "peer_renamed": {
        const participant = this.participants.get(msg.userId);
        if (!participant) return;
        participant.displayName = msg.displayName;
        this.emitParticipants();
        return;
      }

      case "chat_message": {
        // Сервер шлёт сообщение и самому отправителю, поэтому проверяем на
        // дубль: при переподключении оно могло уже прийти в истории.
        // Отправил — значит допечатал: надпись снимаем, не дожидаясь `false`.
        this.dropTyping(msg.message.userId);
        if (this.messages.some((m) => m.id === msg.message.id)) return;
        this.messages = [...this.messages, msg.message];
        this.emitChat();
        return;
      }

      case "peer_typing": {
        if (msg.typing) this.markTyping(msg.userId, msg.displayName);
        else this.dropTyping(msg.userId);
        return;
      }

      case "pong":
        return;
    }
  }

  private createPeer(peerId: string): Peer {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    // Оба условия — настоящие ошибки вызывающего, но разные. Без selfId мы не
    // знаем, кто «вежливый», и перепутали бы порядок предложений. Без потока
    // нечего передавать: сюда попадают только те, кто зашёл с микрофоном.
    if (!this.selfId || !this.localStream) {
      throw new Error("createPeer без selfId или микрофона — так звать нельзя");
    }

    const peer = new Peer({
      selfId: this.selfId,
      peerId,
      iceServers: this.iceServers,
      localStream: this.localStream,
      callbacks: {
        sendSignal: (payload: SignalPayload) => {
          this.socket.send({ type: "signal", to: peerId, payload });
        },
        onTrack: (stream, track) => {
          /*
            Разбираем, что именно приехало. Видео бывает только одно — экран.
            Со звуком сложнее: у экрана бывает своя звуковая дорожка, и от
            микрофонной она отличается ровно тем, что живёт в потоке, где есть
            видео. Поэтому смотрим на поток, а не на дорожку.
          */
          if (track.kind === "video" || stream.getVideoTracks().length > 0) {
            this.addScreenOf(peerId, stream);
            return;
          }

          this.mixer?.add(peerId, stream);
          const participant = this.participants.get(peerId);
          if (participant) {
            participant.hasStream = true;
            this.emitParticipants();
          }

          /*
            Порядок событий не гарантирован: звук экрана может прийти раньше
            своего видео, и тогда проверка выше его пропустит — он окажется в
            микшере как микрофон, и человек услышит показ дважды. Слушаем поток:
            появилось в нём видео — значит это был экран, забираем обратно.
          */
          stream.addEventListener("addtrack", (event) => {
            if (event.track.kind !== "video") return;
            this.mixer?.remove(peerId);
            this.addScreenOf(peerId, stream);
          });
        },
        onStateChange: (state) => {
          if (state === "failed") this.setQuality({ status: "reconnecting" });
          if (state === "connected" && this.quality.status !== "connected") {
            this.setQuality({ status: "connected" });
          }
        },
      },
    });

    this.peers.set(peerId, peer);

    /*
      Если мы уже показываем экран, вошедший должен его увидеть. Без этого показ
      видели бы только те, кто был в канале в момент нажатия кнопки, а зашедший
      через минуту — нет, и выглядело бы это как случайная поломка.

      Заодно пересчитываем потолок: зрителей стало больше, доля каждого меньше.
    */
    if (this.screen) {
      void peer
        .addScreen(this.screen, bitrateFor(this.peers.size))
        .then(() => this.rebalanceScreen());
    }

    return peer;
  }

  private upsertParticipant(participant: Participant): void {
    this.participants.set(participant.userId, {
      ...participant,
      volume: this.mixer?.getVolume(participant.userId) ?? 1,
      hasStream: this.mixer?.has(participant.userId) ?? false,
    });
  }

  /** Худший из peer'ов и есть качество связи — усреднять здесь значит врать. */
  private async pollStats(): Promise<void> {
    if (this.peers.size === 0) return;

    let worstRtt: number | null = null;
    let worstLoss: number | null = null;
    let relayed = false;

    for (const peer of this.peers.values()) {
      const stats = await peer.readStats();
      if (stats.rttMs !== null && (worstRtt === null || stats.rttMs > worstRtt)) {
        worstRtt = stats.rttMs;
      }
      if (stats.packetLoss !== null && (worstLoss === null || stats.packetLoss > worstLoss)) {
        worstLoss = stats.packetLoss;
      }
      if (stats.relayed) relayed = true;
    }

    this.setQuality({ rttMs: worstRtt, packetLoss: worstLoss, relayed });
  }

  // -------------------------------------------------------------------------
  // Подписки
  // -------------------------------------------------------------------------

  onParticipants(cb: (p: VoiceParticipant[]) => void): Unsub {
    this.participantsSubs.add(cb);
    cb([...this.participants.values()]);
    return () => this.participantsSubs.delete(cb);
  }

  onSelf(cb: (s: SelfState) => void): Unsub {
    this.selfSubs.add(cb);
    cb(this.selfState());
    return () => this.selfSubs.delete(cb);
  }

  onQuality(cb: (q: ConnectionQuality) => void): Unsub {
    this.qualitySubs.add(cb);
    cb(this.quality);
    return () => this.qualitySubs.delete(cb);
  }

  rename(displayName: string): void {
    const name = displayName.trim().slice(0, 32);
    if (name) this.socket.send({ type: "rename", displayName: name });
  }

  /**
   * Сообщить, что человек набирает текст.
   *
   * Флаг повторяется не чаще TYPING_REFRESH_MS, а `false` уходит сразу. Слать
   * на каждое нажатие нельзя: на бесплатном плане Cloudflare каждое сообщение
   * WebSocket считается запросом, и один разговорчивый человек съел бы суточный
   * лимит на всех.
   */
  setTyping(typing: boolean): void {
    if (!typing) {
      if (this.typingSentAt === 0) return;
      this.typingSentAt = 0;
      this.socket.send({ type: "typing", typing: false });
      return;
    }

    const now = Date.now();
    if (now - this.typingSentAt < TYPING_REFRESH_MS) return;
    this.typingSentAt = now;
    this.socket.send({ type: "typing", typing: true });
  }

  onTyping(cb: (who: TypingPeer[]) => void): Unsub {
    this.typingSubs.add(cb);
    cb(this.typingList());
    return () => this.typingSubs.delete(cb);
  }

  private markTyping(userId: string, displayName: string): void {
    const existing = this.typing.get(userId);
    if (existing) clearTimeout(existing.timer);

    this.typing.set(userId, {
      displayName,
      // Срок годности: если человек закрыл вкладку на полуслове, `false` не
      // придёт никогда, и без таймера надпись висела бы вечно.
      timer: window.setTimeout(() => this.dropTyping(userId), TYPING_TTL_MS),
    });
    this.emitTyping();
  }

  private dropTyping(userId: string): void {
    const existing = this.typing.get(userId);
    if (!existing) return;
    clearTimeout(existing.timer);
    this.typing.delete(userId);
    this.emitTyping();
  }

  private typingList(): TypingPeer[] {
    return [...this.typing.entries()].map(([userId, v]) => ({
      userId,
      displayName: v.displayName,
    }));
  }

  private emitTyping(): void {
    const list = this.typingList();
    for (const cb of this.typingSubs) cb(list);
  }

  sendChat(text: string, attachment?: Attachment): void {
    const trimmed = text.trim();
    // Картинка без подписи — обычное сообщение; пустое без всего — нет.
    if (!trimmed && !attachment) return;
    this.socket.send({
      type: "chat_send",
      text: trimmed.slice(0, 2000),
      ...(attachment ? { attachment } : {}),
    });
  }

  /**
   * Положить файл в хранилище.
   *
   * Обычный HTTP мимо сокета: на бесплатном плане каждое сообщение WebSocket
   * считается запросом, и картинку пришлось бы резать на сотни кусков.
   *
   * Право — тот же токен канала, которым открыт сокет. Пока его нет, мы ещё
   * не представились каналу, и загружать некуда.
   */
  async uploadFile(file: File, size?: { width: number; height: number }): Promise<Attachment> {
    if (file.size > ATTACHMENT_MAX_BYTES) throw new UploadError("too_big");

    const token = this.socket.currentToken();
    if (!token) throw new UploadError("not_joined");

    const params = new URLSearchParams({ token, name: file.name });
    if (size) {
      params.set("w", String(size.width));
      params.set("h", String(size.height));
    }

    const response = await fetch(`${apiOrigin()}/api/upload?${params}`, {
      method: "POST",
      body: file,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new UploadError(body.error ?? "failed");
    }

    const body = (await response.json()) as { attachment: Attachment };
    return body.attachment;
  }

  onChat(cb: (m: ChatMessage[]) => void): Unsub {
    this.chatSubs.add(cb);
    cb(this.messages);
    return () => this.chatSubs.delete(cb);
  }

  onError(cb: (e: { code: string; message: string }) => void): Unsub {
    this.errorSubs.add(cb);
    return () => this.errorSubs.delete(cb);
  }

  private emitParticipants(): void {
    const list = [...this.participants.values()];
    for (const cb of this.participantsSubs) cb(list);
  }

  private selfState(): SelfState {
    return {
      selfId: this.selfId,
      muted: this.muted,
      deafened: this.deafened,
      speaking: this.speaking,
      transmitting: this.transmitting,
      denoised: this.denoised,
      sharing: this.screen !== null,
    };
  }

  private emitChat(): void {
    const list = this.messages;
    for (const cb of this.chatSubs) cb(list);
  }

  private emitSelf(): void {
    const self = this.selfState();
    for (const cb of this.selfSubs) cb(self);
  }

  private setQuality(patch: Partial<ConnectionQuality>): void {
    this.quality = { ...this.quality, ...patch };
    for (const cb of this.qualitySubs) cb(this.quality);
  }
}
