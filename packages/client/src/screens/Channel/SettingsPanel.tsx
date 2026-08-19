import { useEffect, useState, type FormEvent } from "react";
import { listInputDevices, type AudioDevice } from "../../voice/audio/devices.ts";
import {
  denoiseEnabled,
  rememberDenoise,
  rememberHotkeys,
  rememberMyName,
  savedHotkeys,
} from "../../storage.ts";
import {
  DEFAULT_HOTKEYS,
  autostart as readAutostart,
  hotkeys as readHotkeys,
  isDesktop,
  setAutostart,
  setHotkeys,
} from "../../desktop.ts";
import { comboFrom, describeHotkeyProblem, prettyCombo } from "../../hotkey.ts";

interface SettingsPanelProps {
  selfName: string;
  onClose: () => void;
  onRename: (name: string) => void;
  onPickDevice: (deviceId: string) => Promise<void>;
  /**
   * Работает ли шумодав на самом деле — это ответ движка, а не то, что выбрано
   * в этой панели. Расхождение бывает: wasm мог не загрузиться.
   */
  denoised: boolean;
  onDenoise: (on: boolean) => Promise<void>;
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
  denoised,
  onDenoise,
}: SettingsPanelProps) {
  const [name, setName] = useState(selfName);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [device, setDevice] = useState(() => localStorage.getItem(DEVICE_KEY) ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [denoise, setDenoise] = useState(denoiseEnabled);
  /** Переключение пересобирает тракт: пока идёт, второй клик только навредит. */
  const [switching, setSwitching] = useState(false);
  /** Клавиши настраиваются только в приложении: в браузере системных нет. */
  const desktop = isDesktop();
  const [keys, setKeys] = useState(() => savedHotkeys() ?? DEFAULT_HOTKEYS);
  /** Какую клавишу сейчас переназначаем. `null` — никакую. */
  const [capturing, setCapturing] = useState<"ptt" | "overlay" | null>(null);
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  /** `null`, пока не спросили обёртку. В браузере остаётся null навсегда. */
  const [launch, setLaunch] = useState<boolean | null>(null);

  useEffect(() => {
    // Названия устройств браузер отдаёт только после доступа к микрофону —
    // здесь он уже выдан, потому что мы в канале.
    void listInputDevices().then(setDevices).catch(() => setDevices([]));
  }, []);

  // Спрашиваем обёртку, что забиндено на самом деле. Клавишу мог занять кто-то
  // другой, и тогда сохранённое у нас расходится с работающим — а человек жмёт
  // написанное на экране и считает, что сломалось приложение.
  useEffect(() => {
    if (!desktop) return;
    void readHotkeys().then((actual) => {
      if (actual) setKeys(actual);
    });
  }, [desktop]);

  // Состояние автозапуска спрашиваем у системы, а не помним у себя: человек мог
  // убрать приложение из автозагрузки мимо нас, и показывать «включён» после
  // этого значило бы врать.
  useEffect(() => {
    if (!desktop) return;
    void readAutostart().then(setLaunch);
  }, [desktop]);

  /**
   * Ловим следующее нажатие и делаем из него бинд.
   *
   * Слушаем в фазе перехвата и гасим событие: иначе выбранное сочетание попутно
   * сработает как обычная клавиша — например, уедет в поле имени.
   */
  useEffect(() => {
    if (!capturing) return;

    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Escape — передумал. Клавиша слишком нужна сама по себе, чтобы её занимать.
      if (event.code === "Escape") {
        setCapturing(null);
        setKeyProblem(null);
        return;
      }

      const { combo, problem } = comboFrom(event);
      if (problem) {
        // Модификаторы в одиночку — это ещё не нажатие, ждём продолжения молча.
        if (problem === "modifier-only") return;
        setKeyProblem(describeHotkeyProblem(problem));
        return;
      }

      const next = { ...keys, [capturing]: combo! };
      setCapturing(null);
      setKeyProblem(null);

      void setHotkeys(next)
        .then((applied) => {
          setKeys(applied);
          rememberHotkeys(applied);
          setNote("Клавиша переназначена");
        })
        .catch((error: unknown) => {
          // Обёртка отказала — говорим почему: причин несколько, и они разные.
          setKeyProblem(error instanceof Error ? error.message : String(error));
        });
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturing, keys]);

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

  const toggleDenoise = async () => {
    const next = !denoise;
    setSwitching(true);
    // Запоминаем выбор сразу: он должен пережить этот разговор, даже если
    // пересборка тракта прямо сейчас не удалась.
    setDenoise(next);
    rememberDenoise(next);
    try {
      await onDenoise(next);
      setNote(next ? "Шумодав включён" : "Шумодав выключен");
    } catch {
      setNote("Не удалось переключить шумодав — микрофон занят?");
    } finally {
      setSwitching(false);
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

      <div className="settings__group">
        <span className="settings__label">Шумодав</span>
        <button
          className={`settings__toggle${denoise ? " settings__toggle--on" : ""}`}
          onClick={() => void toggleDenoise()}
          disabled={switching}
          role="switch"
          aria-checked={denoise}
          type="button"
        >
          <span className="settings__knob" />
          <span className="settings__toggle-text">
            {denoise ? "Включён" : "Выключен"}
          </span>
        </button>
        <p className="settings__hint">
          {/*
            Три разных состояния, и путать их нельзя. «Не поднялся» — это не
            «выключен»: человек нажал, а работает браузерная обработка, и знать
            об этом он должен, иначе будет считать, что шумодав не помогает.
          */}
          {!denoise
            ? "Кулер, клавиатура и телевизор уходят собеседникам как есть"
            : denoised
              ? "Убирает шум и во время речи, не только в паузах"
              : switching
                ? "Включаю…"
                : "Не поднялся — остаётся обработка браузера"}
        </p>
      </div>

      {/*
        Только в приложении. В браузере системных клавиш не бывает вовсе, и
        настройка, которая ничего не меняет, хуже отсутствующей.
      */}
      {desktop ? (
        <div className="settings__group">
          <span className="settings__label">Клавиши</span>

          {(
            [
              ["ptt", "Рация"],
              ["overlay", "Панель поверх игры"],
            ] as const
          ).map(([which, title]) => (
            <div className="settings__row" key={which}>
              <span className="settings__keyname">{title}</span>
              <button
                className={`settings__key${capturing === which ? " settings__key--wait" : ""}`}
                onClick={() => {
                  setKeyProblem(null);
                  setCapturing(capturing === which ? null : which);
                }}
                type="button"
              >
                {capturing === which ? "Нажми клавишу…" : prettyCombo(keys[which])}
              </button>
            </div>
          ))}

          <p className="settings__hint">
            {capturing
              ? "Escape — отменить"
              : "Работают, даже когда окно не в фокусе. Панель видна поверх игры в оконном и безрамочном режиме; в полноэкранном её не показать — это умеет только оверлей, встроенный в саму игру."}
          </p>
          {keyProblem ? <p className="settings__problem">{keyProblem}</p> : null}
        </div>
      ) : null}

      {/*
        Автозапуск. Показываем, только когда обёртка ответила: переключатель в
        неизвестном состоянии хуже отсутствующего — по нему нельзя понять, как
        сейчас на самом деле.
      */}
      {desktop && launch !== null ? (
        <div className="settings__group">
          <span className="settings__label">Запускать с системой</span>
          <button
            className={`settings__toggle${launch ? " settings__toggle--on" : ""}`}
            onClick={() => {
              const next = !launch;
              // Рисуем сразу, чтобы нажатие не выглядело проигнорированным, а
              // при отказе возвращаем обратно — иначе переключатель врал бы.
              setLaunch(next);
              void setAutostart(next)
                .then(() => setNote(next ? "Будет запускаться с системой" : "Автозапуск выключен"))
                .catch((error: unknown) => {
                  setLaunch(!next);
                  setNote(error instanceof Error ? error.message : String(error));
                });
            }}
            role="switch"
            aria-checked={launch}
            type="button"
          >
            <span className="settings__knob" />
            <span className="settings__toggle-text">{launch ? "Включено" : "Выключено"}</span>
          </button>
          <p className="settings__hint">
            Badyum поднимется свёрнутым в трей — окно не выскочит, но друзья смогут
            дозвониться сразу.
          </p>
        </div>
      ) : null}

      {note ? <p className="settings__note">{note}</p> : null}
      </div>
    </>
  );
}

/** Устройство, выбранное в прошлый раз. Пустая строка — «по умолчанию». */
export function savedInputDevice(): string | undefined {
  return localStorage.getItem(DEVICE_KEY) || undefined;
}
