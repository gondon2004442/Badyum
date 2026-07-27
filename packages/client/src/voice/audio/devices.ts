/**
 * Захват микрофона.
 *
 * Обработка (эхоподавление, шумодав, AGC) включена намеренно: без неё в
 * игровом сценарии — колонки, механическая клавиатура, кулер — собеседники
 * слышат собственное эхо и стук клавиш.
 */
export async function captureMicrophone(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
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
