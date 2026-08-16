import { report } from "./report.ts";

/**
 * Разговор, переживающий сворачивание приложения.
 *
 * В браузере такого не бывает и быть не может: вкладку усыпляют, и звук
 * пропадает — с этим ничего не сделать со стороны страницы. В Android-обёртке
 * это решается фоновым сервисом, и здесь — единственное место, откуда клиент
 * о нём знает.
 *
 * Зависимости на `@capacitor/core` тут нарочно нет. Пакет `client` собирается и
 * для сайта, и для десктопа, а Capacitor нужен ровно одной сборке из трёх;
 * тянуть его во все — значит класть в бандл код, который в браузере никогда не
 * выполнится. Мост и так лежит в `window`: обёртка вшивает его в страницу до
 * того, как та начнёт исполняться, поэтому достаточно посмотреть, есть ли он.
 */

interface VoiceBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface Capacitor {
  Plugins?: { Voice?: VoiceBridge };
}

function bridge(): VoiceBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { Capacitor?: Capacitor }).Capacitor?.Plugins?.Voice ?? null;
}

/** Внутри ли мы нативной обёртки. */
export function inAppShell(): boolean {
  return bridge() !== null;
}

/**
 * Попросить систему не отбирать микрофон, пока приложение свёрнуто.
 *
 * Ошибку не поднимаем наверх: без фонового режима разговор всё равно
 * состоится, просто оборвётся при сворачивании — то есть ровно так, как он
 * ведёт себя в браузере. Ронять из-за этого вход в канал было бы хуже самой
 * поломки. Но и молчать нельзя, иначе мы никогда не узнаем, что на чьём-то
 * телефоне сервис не поднимается: пишем в журнал ошибок.
 */
export async function holdVoiceInBackground(): Promise<void> {
  const voice = bridge();
  if (!voice) return;

  try {
    await voice.start();
  } catch (error) {
    report("background-voice", error);
  }
}

/**
 * Отпустить.
 *
 * Вызывается на выходе из канала. Если этого не сделать, в шторке навсегда
 * останется висеть «Идёт разговор», а система будет считать, что микрофон
 * занят, — притом что говорить уже не с кем.
 */
export async function releaseVoiceInBackground(): Promise<void> {
  const voice = bridge();
  if (!voice) return;

  try {
    await voice.stop();
  } catch (error) {
    report("background-voice-stop", error);
  }
}
