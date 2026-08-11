/**
 * Исходящий звуковой тракт: от микрофона до дорожки, которую слышат остальные.
 *
 * Без шумодава здесь ничего нет — дорожка из getUserMedia уходит в соединение
 * как есть, ровно как раньше. С шумодавом появляется звуковой граф:
 *
 *   микрофон → MediaStreamSource → RNNoise (worklet) → MediaStreamDestination
 *
 * и собеседникам достаётся дорожка последнего узла, а не микрофона. Отдельный
 * модуль нужен потому, что у этой цепочки три хозяина — вход в канал, смена
 * микрофона и переключатель шумодава — и все трое собирают её одинаково.
 */
import { captureMicrophone } from "./devices.ts";
import { createDenoiseNode, type DenoiseNode } from "./denoise.ts";

export interface MicPipeline {
  /** Дорожка, которая уходит собеседникам. Мьют — это её `enabled`. */
  readonly track: MediaStreamTrack;
  /** Поток с этой дорожкой: его ждёт RTCPeerConnection. */
  readonly stream: MediaStream;
  /**
   * Узел, с которого снимаем индикацию речи.
   *
   * Именно выход шумодава, а не микрофон: кольцо должно загораться от того,
   * что слышат остальные. Иначе оно светилось бы от вентилятора, который до
   * собеседников не доходит.
   */
  readonly analysis: AudioNode;
  /**
   * Работает ли RNNoise на самом деле. Может быть `false` при включённом
   * переключателе — если wasm не загрузился. Врать об этом в интерфейсе нельзя.
   */
  readonly denoised: boolean;
  stop(): void;
}

function audioTrackOf(stream: MediaStream): MediaStreamTrack {
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error("микрофон отдал поток без звуковой дорожки");
  return track;
}

/**
 * Собрать тракт заново.
 *
 * `wantDenoise` — это желание, а не гарантия: если шумодав не поднялся,
 * возвращаемся к браузерному и честно говорим об этом через `denoised`.
 */
export async function createMicPipeline(
  context: AudioContext,
  deviceId: string | undefined,
  wantDenoise: boolean,
): Promise<MicPipeline> {
  /*
    Шумодав поднимаем ДО захвата микрофона: от того, получилось ли, зависит,
    о чём мы попросим браузер. Наоборот нельзя — не загрузился бы wasm, и мы
    остались бы с микрофоном, у которого выключен и наш шумодав, и браузерный.
  */
  const denoiser = wantDenoise ? await createDenoiseNode(context) : null;
  const raw = await captureMicrophone(deviceId, { noiseSuppression: denoiser === null });

  if (!denoiser) {
    return {
      track: audioTrackOf(raw),
      stream: raw,
      analysis: context.createMediaStreamSource(raw),
      denoised: false,
      stop: () => stopTracks(raw),
    };
  }

  const source = context.createMediaStreamSource(raw);
  const sink = context.createMediaStreamDestination();
  source.connect(denoiser).connect(sink);

  return {
    track: audioTrackOf(sink.stream),
    stream: sink.stream,
    analysis: denoiser,
    denoised: true,
    stop: () => stopChain(raw, source, denoiser, sink),
  };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function stopChain(
  raw: MediaStream,
  source: MediaStreamAudioSourceNode,
  denoiser: DenoiseNode,
  sink: MediaStreamAudioDestinationNode,
): void {
  source.disconnect();
  denoiser.disconnect();
  // Освобождает состояние модели внутри worklet: без этого при каждой смене
  // микрофона за разговор оставался бы висеть ещё один экземпляр сети.
  denoiser.destroy();
  // Микрофон отпускаем последним — иначе индикатор записи в браузере гаснет
  // раньше, чем перестаёт течь звук, и это выглядит как ложное срабатывание.
  stopTracks(raw);
  stopTracks(sink.stream);
}
