/**
 * Детектор речи по локальному потоку.
 *
 * Считаем только СВОЙ голос и отправляем результат остальным через сигналинг.
 * Считать VAD по всем входящим потокам — лишняя нагрузка на CPU там, где её
 * меньше всего можно себе позволить: на телефоне и на машине, которая уже
 * тянет игру.
 *
 * Порог с гистерезисом и «хвостом»: без них кольцо аватара мигает в паузах
 * между словами и выглядит сломанным.
 */

const ENTER_THRESHOLD = 0.012;
const EXIT_THRESHOLD = 0.006;
const HANGOVER_MS = 250;
const POLL_MS = 60;

export interface VadHandle {
  stop(): void;
}

export function createVad(
  context: AudioContext,
  source: AudioNode,
  onChange: (speaking: boolean, level: number) => void,
): VadHandle {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.4;
  source.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);
  let speaking = false;
  let lastLoudAt = 0;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;

    analyser.getFloatTimeDomainData(buffer);

    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = buffer[i] ?? 0;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);

    const now = Date.now();
    if (rms > ENTER_THRESHOLD) lastLoudAt = now;

    const next = speaking
      ? rms > EXIT_THRESHOLD || now - lastLoudAt < HANGOVER_MS
      : rms > ENTER_THRESHOLD;

    if (next !== speaking) {
      speaking = next;
      onChange(speaking, rms);
    }
  }, POLL_MS);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      try {
        source.disconnect(analyser);
      } catch {
        // Узел мог быть уже отсоединён вместе с закрытым контекстом.
      }
    },
  };
}
