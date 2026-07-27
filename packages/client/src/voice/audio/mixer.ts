/**
 * Микшер входящих потоков.
 *
 * Каждый собеседник идёт через свой GainNode — так у пользователя появляется
 * громкость на конкретного человека, а не общий регулятор.
 *
 * Засада, из-за которой это выглядит сложнее, чем кажется: в Chrome поток из
 * WebRTC не «поедет» в Web Audio, если его дополнительно не привязать к
 * <audio>-элементу. Элемент создаётся и держится muted — звук идёт через граф,
 * а элемент существует только чтобы разбудить поток.
 */

interface Sink {
  stream: MediaStream;
  element: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  volume: number;
}

export class Mixer {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly sinks = new Map<string, Sink>();

  constructor(context: AudioContext) {
    this.context = context;
    this.master = context.createGain();
    this.master.connect(context.destination);
  }

  add(userId: string, stream: MediaStream): void {
    this.remove(userId);

    const element = document.createElement("audio");
    element.srcObject = stream;
    element.autoplay = true;
    // Звук выходит через Web Audio; элемент нужен только чтобы Chrome начал
    // отдавать поток. Если его не заглушить — услышим собеседника дважды.
    element.muted = true;
    element.play().catch(() => {
      // На iOS до пользовательского жеста play() отклоняется — это ожидаемо,
      // кнопка «Войти в канал» и есть тот жест.
    });

    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(this.master);

    this.sinks.set(userId, { stream, element, source, gain, volume: 1 });
  }

  remove(userId: string): void {
    const sink = this.sinks.get(userId);
    if (!sink) return;

    try {
      sink.source.disconnect();
      sink.gain.disconnect();
    } catch {
      // Граф мог быть уже разобран.
    }
    sink.element.srcObject = null;
    sink.element.remove();
    this.sinks.delete(userId);
  }

  setVolume(userId: string, volume: number): void {
    const sink = this.sinks.get(userId);
    if (!sink) return;
    sink.volume = clamp(volume, 0, 2);
    sink.gain.gain.value = sink.volume;
  }

  getVolume(userId: string): number {
    return this.sinks.get(userId)?.volume ?? 1;
  }

  has(userId: string): boolean {
    return this.sinks.has(userId);
  }

  /** «Оглохнуть»: рубим весь выход разом, не трогая индивидуальные громкости. */
  setDeafened(deafened: boolean): void {
    this.master.gain.value = deafened ? 0 : 1;
  }

  destroy(): void {
    for (const userId of [...this.sinks.keys()]) this.remove(userId);
    try {
      this.master.disconnect();
    } catch {
      // already disconnected
    }
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
