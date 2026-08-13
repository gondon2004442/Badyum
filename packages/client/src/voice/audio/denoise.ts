/**
 * Шумодав RNNoise.
 *
 * Это не порог по громкости, а обученная сеть (xiph/rnnoise, скомпилированная
 * в wasm): она вычищает вентилятор, клавиатуру и телевизор в том числе пока
 * человек говорит, а не только в паузах. Браузерный шумодав так не умеет.
 *
 * Считает в AudioWorklet — то есть в аудиопотоке, а не в основном потоке
 * страницы. Подвисший рендер не должен превращаться в заикание голоса.
 *
 * Грузится лениво и отдельным чанком: ~150 КБ wasm не должны попадать в первую
 * загрузку страницы тому, кто зашёл прочитать переписку.
 */
import { report } from "../../report.ts";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

/** Узел шумодава. `destroy` освобождает состояние модели внутри worklet. */
export interface DenoiseNode extends AudioNode {
  destroy(): void;
}

/**
 * Бинарник и регистрация worklet переиспользуются.
 *
 * Модель одна на вкладку: при смене микрофона и при переходе из канала в
 * личный звонок качать её заново незачем.
 */
let binary: Promise<ArrayBuffer> | null = null;
const registered = new WeakSet<BaseAudioContext>();

async function prepare(context: AudioContext): Promise<ArrayBuffer> {
  // Динамический импорт, а не обычный: библиотека и всё, что она тянет, должны
  // остаться в отдельном чанке.
  const { loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");

  // Ветка с SIMD считает заметно быстрее, но есть не везде — выбор внутри
  // loadRnnoise, по фактической поддержке, а не по названию браузера.
  binary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  const wasm = await binary;

  if (!registered.has(context)) {
    await context.audioWorklet.addModule(rnnoiseWorkletUrl);
    registered.add(context);
  }

  return wasm;
}

/**
 * Поднять шумодав в этом аудиоконтексте.
 *
 * `null` означает «не получилось» и это не ошибка вызывающего: сеть могла
 * не отдать wasm, а старый браузер — не знать AudioWorklet. Вызывающий обязан
 * в этом случае оставить браузерный шумодав включённым, иначе человек
 * останется вообще без обработки и это будет звучать хуже, чем было.
 */
export async function createDenoiseNode(context: AudioContext): Promise<DenoiseNode | null> {
  if (!context.audioWorklet) return null;

  try {
    const wasm = await prepare(context);
    const { RnnoiseWorkletNode } = await import("@sapphi-red/web-noise-suppressor");

    // Микрофон мы просим моно, но браузер не обязан слушаться — на паре
    // устройств приходит стерео, и запас в один канал дешевле, чем тишина.
    return new RnnoiseWorkletNode(context, { wasmBinary: wasm, maxChannels: 2 });
  } catch (error) {
    console.warn("[badyum] шумодав не поднялся, остаётся браузерный", error);
    // Человек этого не заметит — звук пойдёт с браузерной обработкой, — но нам
    // знать надо: молчаливая деградация у всех сразу выглядит как «шумодав не
    // помогает», и без этой строки причину искали бы в модели.
    report("denoise", error);
    // Неудачную загрузку не кэшируем: следующая попытка должна быть честной.
    binary = null;
    return null;
  }
}
