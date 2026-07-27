import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MeshEngine } from "./MeshEngine.ts";
import type {
  ConnectionQuality,
  SelfState,
  VoiceEngine,
  VoiceParticipant,
} from "./VoiceEngine.ts";
import { wsUrl } from "../api.ts";
import { InsecureContextError } from "./audio/devices.ts";


/**
 * Единственный мост между React и звуком.
 *
 * Компоненты не знают ни про WebRTC, ни про сигналинг — только про этот хук.
 * Когда появится SfuEngine, поменяется одна строка ниже, и ни один экран
 * не будет затронут.
 */
export function useVoice() {
  const engineRef = useRef<VoiceEngine | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [self, setSelf] = useState<SelfState>({
    muted: false,
    deafened: false,
    speaking: false,
    transmitting: true,
  });
  const [quality, setQuality] = useState<ConnectionQuality>({
    status: "idle",
    rttMs: null,
    packetLoss: null,
    relayed: false,
  });
  const [error, setError] = useState<string | null>(null);

  const engine = useMemo(() => {
    const created: VoiceEngine = new MeshEngine(wsUrl());
    engineRef.current = created;
    return created;
  }, []);

  useEffect(() => {
    const unsubs = [
      engine.onParticipants(setParticipants),
      engine.onSelf(setSelf),
      engine.onQuality(setQuality),
      engine.onError((e) => setError(e.message)),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [engine]);

  // Уходя со страницы, выходим из канала явно — иначе остальные несколько
  // секунд видят аватар человека, которого уже нет.
  useEffect(() => {
    const onUnload = () => void engine.leave();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      void engine.leave();
    };
  }, [engine]);

  const join = useCallback(
    async (token: string) => {
      setError(null);
      try {
        await engine.join({ token });
      } catch (err) {
        setError(describeMicError(err));
        throw err;
      }
    },
    [engine],
  );

  return {
    participants,
    self,
    quality,
    error,
    join,
    leave: useCallback(() => engine.leave(), [engine]),
    setMuted: useCallback((m: boolean) => engine.setMuted(m), [engine]),
    setDeafened: useCallback((d: boolean) => engine.setDeafened(d), [engine]),
    setTransmitting: useCallback((t: boolean) => engine.setTransmitting(t), [engine]),
    setParticipantVolume: useCallback(
      (userId: string, volume: number) => engine.setParticipantVolume(userId, volume),
      [engine],
    ),
  };
}

/**
 * Почему микрофон не включился — словами, из которых понятно, что делать.
 *
 * Разница принципиальная: «разреши доступ» бесполезно, когда разрешать негде,
 * а именно так выглядит открытие страницы по локальному IP.
 */
function describeMicError(error: unknown): string {
  if (error instanceof InsecureContextError) {
    return "Браузер отдаёт микрофон только по https или на localhost. По локальному IP это невозможно — открой через https-туннель.";
  }
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Нужен доступ к микрофону — разреши его в настройках браузера";
    }
    if (error.name === "NotFoundError") {
      return "Микрофон не найден — проверь, что он подключён";
    }
    if (error.name === "NotReadableError") {
      return "Микрофон занят другим приложением";
    }
  }
  return "Не получилось включить микрофон";
}

/**
 * Push-to-talk на клавише.
 *
 * Работает только пока вкладка в фокусе — браузер не даёт глобальных хоткеев.
 * Свернул в игру, и рация замолкает. Это и есть главная причина, по которой
 * нужна десктопная обёртка (Tauri), а не просто «сайт на весь экран».
 */
export function usePushToTalk(
  key: string | null,
  onChange: (transmitting: boolean) => void,
): void {
  useEffect(() => {
    if (!key) {
      onChange(true);
      return;
    }

    onChange(false);
    const matches = (event: KeyboardEvent) => event.code === key || event.key === key;

    const down = (event: KeyboardEvent) => {
      if (event.repeat || !matches(event)) return;
      event.preventDefault();
      onChange(true);
    };
    const up = (event: KeyboardEvent) => {
      if (!matches(event)) return;
      event.preventDefault();
      onChange(false);
    };
    // Потеря фокуса без keyup оставила бы микрофон открытым навсегда.
    const blur = () => onChange(false);

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      onChange(true);
    };
  }, [key, onChange]);
}
