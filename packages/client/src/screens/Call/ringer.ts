import { useEffect } from "react";

/** Входящий: две ноты, как у телефона. Исходящий: одна, длинный гудок. */
const PATTERNS = {
  ringing: { tones: [880, 660], on: 0.4, gap: 0.15, period: 2.2, gain: 0.09 },
  dialing: { tones: [440], on: 0.9, gap: 0, period: 3.4, gain: 0.05 },
} as const;

/**
 * Звук звонка.
 *
 * Синтезируем через Web Audio, а не проигрываем файл: звонок нужен ровно один
 * и на пару секунд, а лишний mp3 в сборке — это лишние килобайты на канале,
 * который у части людей и так еле дышит.
 *
 * Браузер не даст запустить звук без предшествующего жеста. Для входящего это
 * обычно не проблема: страница уже открыта и человек с ней взаимодействовал.
 * Если всё же не дали — молчим, а не роняем экран: увидеть звонок важнее, чем
 * услышать.
 */
export function useRinger(kind: "ringing" | "dialing" | "accepted"): void {
  useEffect(() => {
    if (kind === "accepted") return;

    const pattern = PATTERNS[kind];
    let context: AudioContext | null = null;
    let timer: number | null = null;

    try {
      context = new AudioContext();
    } catch {
      return;
    }

    const beep = () => {
      const ctx = context;
      if (!ctx || ctx.state === "closed") return;

      pattern.tones.forEach((frequency, index) => {
        const at = ctx.currentTime + index * (pattern.on + pattern.gap);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.frequency.value = frequency;
        osc.type = "sine";

        // Мягкие фронты: прямоугольная огибающая даёт щелчок на старте и стопе.
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(pattern.gain, at + 0.04);
        gain.gain.setValueAtTime(pattern.gain, at + pattern.on - 0.06);
        gain.gain.linearRampToValueAtTime(0, at + pattern.on);

        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + pattern.on + 0.02);
      });
    };

    void context.resume().catch(() => {});
    beep();
    timer = window.setInterval(beep, pattern.period * 1000);

    return () => {
      if (timer !== null) clearInterval(timer);
      void context?.close().catch(() => {});
    };
  }, [kind]);
}
