import { isPolite, type SignalPayload } from "@badyum/shared";

/**
 * Сколько терпим `disconnected` до принудительного ICE restart. Короткие
 * просадки сети рассасываются сами, и рестарт на каждую из них рвал бы звук
 * чаще, чем чинил.
 */
const ICE_GRACE_MS = 3000;

interface PeerCallbacks {
  sendSignal: (payload: SignalPayload) => void;
  onTrack: (stream: MediaStream) => void;
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

    this.pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (stream) this.cb.onTrack(stream);
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
