/**
 * Захват микрофона.
 *
 * Обработка (эхоподавление, шумодав, AGC) включена намеренно: без неё в
 * игровом сценарии — колонки, механическая клавиатура, кулер — собеседники
 * слышат собственное эхо и стук клавиш.
 */
/**
 * Страница открыта там, где браузер в принципе не отдаёт микрофон.
 *
 * Микрофон доступен только в защищённом контексте: https или localhost. По
 * локальному IP (http://192.168.x.x) `navigator.mediaDevices` просто не
 * существует — это не отказ в правах, разрешать нечего. Отдельный тип нужен,
 * чтобы не показывать «разреши доступ в настройках»: разрешать негде.
 */
export class InsecureContextError extends Error {
  constructor() {
    super("микрофон доступен только по https или на localhost");
    this.name = "InsecureContextError";
  }
}

export interface CaptureOptions {
  /**
   * Браузерный шумодав.
   *
   * Выключаем ровно в одном случае: когда дальше в тракте стоит свой, RNNoise.
   * Два шумодава подряд — не «чище вдвое»: браузерный срезает стационарный шум
   * и отдаёт сети сигнал, на котором её не учили, и голос становится
   * металлическим. В тракте должен быть ровно один. Эхоподавление и AGC — это
   * другая работа, они остаются включёнными всегда.
   */
  noiseSuppression?: boolean;
}

export async function captureMicrophone(
  deviceId?: string,
  { noiseSuppression = true }: CaptureOptions = {},
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new InsecureContextError();
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
    },
    video: false,
  });
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

/**
 * Список микрофонов. До первого getUserMedia браузер отдаёт устройства без
 * названий — поэтому вызывать это имеет смысл уже после входа в канал.
 */
export async function listInputDevices(): Promise<AudioDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Микрофон ${index + 1}`,
    }));
}

/**
 * AudioContext создаётся в suspended до пользовательского жеста — на iOS это
 * жёсткое правило. Вызывать resume() надо из обработчика клика.
 */
export function createAudioContext(): AudioContext {
  return new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
}
