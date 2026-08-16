import { isPolite, type SignalPayload } from "@badyum/shared";

/**
 * Сколько терпим `disconnected` до принудительного ICE restart. Короткие
 * просадки сети рассасываются сами, и рестарт на каждую из них рвал бы звук
 * чаще, чем чинил.
 */
const ICE_GRACE_MS = 3000;

interface PeerCallbacks {
  sendSignal: (payload: SignalPayload) => void;
  /**
   * Дорожка передаётся вместе с потоком: по её виду вызывающий решает, звук
   * это или демонстрация экрана. Раньше поток был один и разбирать было нечего.
   */
  onTrack: (stream: MediaStream, track: MediaStreamTrack) => void;
  onStateChange: (state: RTCPeerConnectionState) => void;
}

/**
 * Одно соединение с одним собеседником.
 *
 * Здесь живёт perfect negotiation. Смысл: при одновременном входе двух человек
 * оба посылают offer, оба получают чужой offer в состоянии have-local-offer и
 * оба откатываются — соединение навсегда виснет на "Подключаюсь". Лечится тем,
 * что роли в паре заранее разведены: "вежливый" уступает и откатывает свой
 * offer, "невежливый" игнорирует чужой. Сравнение userId даёт обеим сторонам
 * одинаковый ответ без единого дополнительного сообщения.
 *
 * Реализация следует каноническому паттерну из спецификации WebRTC.
 */
export class Peer {
  readonly userId: string;

  private readonly pc: RTCPeerConnection;
  private readonly polite: boolean;
  private readonly cb: PeerCallbacks;

  /** Мы в процессе установки описания — входящий offer сейчас трогать нельзя. */
  private makingOffer = false;
  /** Мы решили проигнорировать чужой offer; его ICE-кандидаты тоже игнорируем. */
  private ignoreOffer = false;
  /** Идёт установка чужого answer: в этот момент состояние временно не stable. */
  private settingRemoteAnswer = false;
  private closed = false;
  /** Хвост очереди применения сигналов, см. acceptSignal. */
  private queue: Promise<void> = Promise.resolve();
  /** Выдержка перед ICE restart в состоянии disconnected. */
  private iceGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Отправители демонстрации экрана — те, что завели мы.
   *
   * Держим списком, а не ищем по виду дорожки: у экрана бывает своя звуковая
   * дорожка, и от микрофонной она ничем не отличается, кроме нашей памяти.
   */
  private screenSenders: RTCRtpSender[] = [];

  constructor(opts: {
    selfId: string;
    peerId: string;
    iceServers: RTCIceServer[];
    localStream: MediaStream;
    callbacks: PeerCallbacks;
  }) {
    this.userId = opts.peerId;
    this.polite = isPolite(opts.selfId, opts.peerId);
    this.cb = opts.callbacks;

    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers,
      // Пул заранее собранных кандидатов заметно сокращает время до звука.
      iceCandidatePoolSize: 4,
    });

    for (const track of opts.localStream.getAudioTracks()) {
      this.pc.addTrack(track, opts.localStream);
    }

    this.pc.onnegotiationneeded = async () => {
      // Событие может прилететь, пока мы уже разбираем чужой offer: тогда
      // setLocalDescription() создаст ВТОРОЙ answer, собеседник получит его в
      // состоянии stable и соединение упадёт с InvalidStateError. Оффер имеет
      // смысл только из stable.
      if (this.pc.signalingState !== "stable") return;

      try {
        this.makingOffer = true;
        // Без аргументов: браузер сам выберет offer или rollback-совместимое
        // состояние. Ручной createOffer здесь и порождает гонки.
        await this.pc.setLocalDescription();
        const description = this.pc.localDescription;
        if (description) {
          this.cb.sendSignal({
            kind: "description",
            description: { type: description.type, sdp: withOpusTuning(description.sdp) },
          });
        }
      } catch (error) {
        console.error("[peer] negotiation failed", error);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = ({ candidate }) => {
      this.cb.sendSignal({
        kind: "candidate",
        candidate: candidate
          ? {
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid,
              sdpMLineIndex: candidate.sdpMLineIndex,
              usernameFragment: candidate.usernameFragment,
            }
          : null,
      });
    };

    this.pc.ontrack = ({ streams, track }) => {
      const stream = streams[0];
      if (stream) this.cb.onTrack(stream, track);
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onStateChange(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;

      // ICE restart — единственное, что вытаскивает соединение после смены сети
      // (ушли с Wi-Fi на LTE) без полного пересоздания.
      if (state === "failed") {
        this.clearIceGrace();
        this.pc.restartIce();
        return;
      }

      // `disconnected` часто рассасывается сам за секунду-другую, и рестарт
      // здесь только оборвал бы живой звук. Но если состояние держится, ждать
      // перехода в `failed` дорого: браузер тянет с этим десятки секунд.
      if (state === "disconnected") {
        this.clearIceGrace();
        this.iceGraceTimer = setTimeout(() => {
          this.iceGraceTimer = null;
          if (this.closed) return;
          if (this.pc.iceConnectionState === "disconnected") this.pc.restartIce();
        }, ICE_GRACE_MS);
        return;
      }

      if (state === "connected" || state === "completed") this.clearIceGrace();
    };
  }

  /**
   * Сигналы обязаны применяться строго по одному и в порядке поступления.
   *
   * Без очереди два подряд пришедших описания входят в обработку одновременно:
   * оба проверяют signalingState до того, как первый успел его изменить, оба
   * решают, что всё в порядке, и второй падает с InvalidStateError. Промис-
   * цепочка — самый дешёвый способ это исключить.
   */
  acceptSignal(payload: SignalPayload): Promise<void> {
    this.queue = this.queue.then(() => this.applySignal(payload)).catch((error) => {
      console.warn("[peer] signal dropped", error);
    });
    return this.queue;
  }

  private async applySignal(payload: SignalPayload): Promise<void> {
    if (this.closed) return;

    if (payload.kind === "candidate") {
      try {
        if (payload.candidate) {
          await this.pc.addIceCandidate(payload.candidate);
        }
      } catch (error) {
        // Кандидаты отвергнутого offer'а прилетают штатно — это не ошибка.
        if (!this.ignoreOffer) console.warn("[peer] ICE candidate rejected", error);
      }
      return;
    }

    const description = payload.description;

    // Answer имеет смысл только когда мы сами ждём ответа на свой offer.
    // Дубликат или опоздавший answer в stable — это InvalidStateError.
    if (description.type === "answer" && this.pc.signalingState !== "have-local-offer") {
      return;
    }

    const readyForOffer =
      !this.makingOffer &&
      (this.pc.signalingState === "stable" || this.settingRemoteAnswer);
    const offerCollision = description.type === "offer" && !readyForOffer;

    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    this.settingRemoteAnswer = description.type === "answer";
    try {
      await this.pc.setRemoteDescription(description as RTCSessionDescriptionInit);
    } finally {
      this.settingRemoteAnswer = false;
    }

    if (description.type === "offer") {
      await this.pc.setLocalDescription();
      const local = this.pc.localDescription;
      if (local) {
        this.cb.sendSignal({
          kind: "description",
          description: { type: local.type, sdp: withOpusTuning(local.sdp) },
        });
      }
    }
  }

  /**
   * Смена микрофона на лету. Именно replaceTrack, а не пересогласование:
   * пересогласование здесь означало бы разрыв звука сразу у всех собеседников
   * ради того, что для них вообще не изменилось.
   */
  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (this.closed) return;
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "audio");
    if (sender) await sender.replaceTrack(track);
  }

  /**
   * Начать отдавать этому собеседнику экран.
   *
   * Здесь именно addTrack и пересогласование, а не replaceTrack: видеодорожки
   * в соединении до сих пор не было вовсе, и подменять нечего. Пересогласование
   * запустит onnegotiationneeded, а perfect negotiation разберётся, даже если
   * двое нажали «показать» одновременно.
   */
  async addScreen(stream: MediaStream, maxBitrate: number): Promise<void> {
    if (this.closed) return;

    // Повторный вызов без снятия предыдущего дал бы вторую видеодорожку в том
    // же соединении, и собеседник увидел бы два экрана.
    this.stopScreen();

    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      this.screenSenders.push(sender);
      if (track.kind === "video") await tuneVideo(sender, maxBitrate);
    }
  }

  /**
   * Перестать показывать.
   *
   * Убираем ровно тех отправителей, которых сами и завели. Искать их по виду
   * дорожки было бы неверно: у экрана бывает своя звуковая дорожка, и она
   * неотличима от микрофонной ничем, кроме того, что мы помним её сами.
   */
  stopScreen(): void {
    if (this.closed) return;

    for (const sender of this.screenSenders) {
      try {
        this.pc.removeTrack(sender);
      } catch {
        // Соединение могло уйти из-под ног между решением и действием.
      }
    }
    this.screenSenders = [];
  }

  /**
   * Пересчитать потолок битрейта.
   *
   * В mesh каждый зритель получает свою копию потока, и исходящий канал делится
   * между ними. Вошёл третий — потолок каждому надо опустить, иначе upstream
   * домашнего интернета кончается и сыпется уже не картинка, а голос.
   */
  async setScreenBitrate(maxBitrate: number): Promise<void> {
    if (this.closed) return;
    const sender = this.screenSenders.find((s) => s.track?.kind === "video");
    if (sender) await tuneVideo(sender, maxBitrate);
  }

  /** Статистика для индикатора качества. Врать зелёным индикатором нельзя. */
  async readStats(): Promise<{ rttMs: number | null; packetLoss: number | null; relayed: boolean }> {
    if (this.closed) return { rttMs: null, packetLoss: null, relayed: false };

    let rttMs: number | null = null;
    let packetLoss: number | null = null;
    let relayed = false;

    const stats = await this.pc.getStats();
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        if (typeof report.currentRoundTripTime === "number") {
          rttMs = Math.round(report.currentRoundTripTime * 1000);
        }
      }
      if (report.type === "local-candidate" && report.candidateType === "relay") {
        relayed = true;
      }
      if (report.type === "inbound-rtp" && report.kind === "audio") {
        const lost = report.packetsLost ?? 0;
        const received = report.packetsReceived ?? 0;
        const total = lost + received;
        if (total > 0) packetLoss = lost / total;
      }
    });

    return { rttMs, packetLoss, relayed };
  }

  /** Есть ли рабочее медиа-соединение прямо сейчас. */
  isConnected(): boolean {
    return !this.closed && this.pc.connectionState === "connected";
  }

  private clearIceGrace(): void {
    if (this.iceGraceTimer === null) return;
    clearTimeout(this.iceGraceTimer);
    this.iceGraceTimer = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIceGrace();
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.close();
  }
}

/**
 * Правки SDP под голос:
 *  - `usedtx=1` — в тишине пакеты не идут вообще. На мобильном трафике и на
 *    слабом канале это самая дешёвая оптимизация из существующих.
 *  - `maxaveragebitrate` — 32 кбит/с для речи достаточно, выше только греет сеть.
 *  - `stereo=0` — микрофон моно, стерео удваивает поток впустую.
 */
function withOpusTuning(sdp: string | undefined): string | undefined {
  if (!sdp) return sdp;

  const opusPayload = sdp.match(/a=rtpmap:(\d+) opus\/48000/)?.[1];
  if (!opusPayload) return sdp;

  const fmtpPattern = new RegExp(`a=fmtp:${opusPayload} (.*)`);
  const existing = sdp.match(fmtpPattern);

  const tuning = "usedtx=1;stereo=0;maxaveragebitrate=32000;useinbandfec=1";
  if (existing) {
    return sdp.replace(fmtpPattern, `a=fmtp:${opusPayload} ${existing[1]};${tuning}`);
  }
  return sdp.replace(
    `a=rtpmap:${opusPayload} opus/48000`,
    `a=rtpmap:${opusPayload} opus/48000\r\na=fmtp:${opusPayload} ${tuning}`,
  );
}

/**
 * Настройка исходящего видео. Три параметра, и первые два важнее третьего.
 *
 * `contentHint = "detail"` — это экран, а не камера. Разница не косметическая:
 * при `"motion"` браузер держит частоту кадров и жертвует разрешением, и
 * 1920×1080 уезжает в 640×360 даже тогда, когда канал позволяет вчетверо
 * больше. На экране дорого именно разрешение: размытый текст и интерфейс не
 * читаются вовсе, а пропущенный кадр обычно незаметен — картинка почти всё
 * время стоит.
 *
 * `degradationPreference = "maintain-resolution"` — то же самое, сказанное
 * явно. Без него браузер выбирает сам, исходя из подсказки, и выбирает не в
 * нашу пользу.
 *
 * `maxBitrate` — потолок, а не запрос. Пока на экране ничего не движется,
 * уходят десятки килобит: кодировщик платит за изменения, а не за пиксели.
 * В mesh потолок делится на зрителей — каждый получает свою копию.
 */
async function tuneVideo(sender: RTCRtpSender, maxBitrate: number): Promise<void> {
  if (sender.track) sender.track.contentHint = "detail";

  const parameters = sender.getParameters();
  // Пустой encodings встречается до первого пересогласования — тогда правку
  // применит следующий вызов, уже после установки описания.
  if (!parameters.encodings?.length) parameters.encodings = [{}];
  parameters.encodings[0]!.maxBitrate = maxBitrate;
  // Явный запрет уменьшать картинку: именно это и происходило.
  parameters.encodings[0]!.scaleResolutionDownBy = 1;
  parameters.degradationPreference = "maintain-resolution";

  try {
    await sender.setParameters(parameters);
  } catch (error) {
    // Не критично: без настройки картинка просто хуже и жаднее к каналу.
    console.warn("[peer] не удалось настроить видео", error);
  }
}
