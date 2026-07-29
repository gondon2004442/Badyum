import { useEffect, useState, type FormEvent } from "react";
import { listInputDevices, type AudioDevice } from "../../voice/audio/devices.ts";
import { rememberMyName } from "../../storage.ts";

interface SettingsPanelProps {
  selfName: string;
  onClose: () => void;
  onRename: (name: string) => void;
  onPickDevice: (deviceId: string) => Promise<void>;
}

const DEVICE_KEY = "badyum:input-device";

/**
 * Настройки.
 *
 * Всё, что здесь есть, применяется сразу: имя уходит в канал отдельным
 * сообщением, микрофон подменяется в живых соединениях через replaceTrack.
 * Настройка, которая «вступит в силу при следующем входе», выглядела бы
 * сломанной.
 */
export function SettingsPanel({
  selfName,
  onClose,
  onRename,
  onPickDevice,
}: SettingsPanelProps) {
  const [name, setName] = useState(selfName);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [device, setDevice] = useState(() => localStorage.getItem(DEVICE_KEY) ?? "");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    // Названия устройств браузер отдаёт только после доступа к микрофону —
    // здесь он уже выдан, потому что мы в канале.
    void listInputDevices().then(setDevices).catch(() => setDevices([]));
  }, []);

  const submitName = (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim().slice(0, 32);
    if (!value || value === selfName) return;

    onRename(value);
    rememberMyName(value);
    setNote("Имя обновлено");
  };

  const pickDevice = async (deviceId: string) => {
    setDevice(deviceId);
    localStorage.setItem(DEVICE_KEY, deviceId);
    try {
      await onPickDevice(deviceId);
      setNote("Микрофон переключён");
    } catch {
      setNote("Не удалось переключить микрофон");
    }
  };

  return (
    <>
      {/* Клик мимо закрывает: модалка без подложки ощущается как застрявшая. */}
      <div className="settings__backdrop" onClick={onClose} />
      <div className="settings" role="dialog" aria-label="Настройки">
      <div className="settings__head">
        <span className="settings__title">Настройки</span>
        <button className="settings__close" onClick={onClose} type="button" title="Закрыть">
          ×
        </button>
      </div>

      <form className="settings__group" onSubmit={submitName}>
        <label className="settings__label" htmlFor="settings-name">
          Как тебя видно
        </label>
        <div className="settings__row">
          <input
            id="settings-name"
            className="settings__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
          />
          <button
            className="settings__apply"
            type="submit"
            disabled={!name.trim() || name.trim() === selfName}
          >
            Сменить
          </button>
        </div>
        <p className="settings__hint">Изменится сразу у всех в канале</p>
      </form>

      <div className="settings__group">
        <label className="settings__label" htmlFor="settings-device">
          Микрофон
        </label>
        <select
          id="settings-device"
          className="settings__select"
          value={device}
          onChange={(e) => void pickDevice(e.target.value)}
        >
          <option value="">По умолчанию</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <p className="settings__hint">
          {devices.length === 0
            ? "Устройства не найдены"
            : "Переключится в текущем разговоре, без разрыва"}
        </p>
      </div>

      {note ? <p className="settings__note">{note}</p> : null}
      </div>
    </>
  );
}

/** Устройство, выбранное в прошлый раз. Пустая строка — «по умолчанию». */
export function savedInputDevice(): string | undefined {
  return localStorage.getItem(DEVICE_KEY) || undefined;
}
