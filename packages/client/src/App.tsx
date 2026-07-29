import { useCallback, useState } from "react";
import { JoinScreen, type JoinTarget } from "./screens/Join/JoinScreen.tsx";
import { ChannelScreen } from "./screens/Channel/ChannelScreen.tsx";
import { createChannel, requestJoin } from "./api.ts";
import { myName, rememberChannel, type RecentChannel } from "./storage.ts";

interface Session {
  token: string;
  channelId: string;
  channelName: string;
  displayName: string;
  /** Код инвайта, если знаем: по нему канал попадает в «недавние». */
  code: string | null;
}

/**
 * Разбор адреса.
 *
 * Три из четырёх способов связи — это один и тот же путь в браузер:
 *   /j/<код>   — инвайт-ссылка (и QR, потому что QR кодирует именно её)
 *   /r/<слово> — кодовое слово-комната
 * Сервер сводит их в channelId, поэтому дальше экраны одинаковы.
 */
function parseTarget(): JoinTarget | null {
  const [, kind, value] = location.pathname.split("/");
  if (!value) return null;
  if (kind === "j") return { code: value };
  if (kind === "r") return { slug: decodeURIComponent(value) };
  return null;
}

export function App() {
  const [target] = useState<JoinTarget | null>(parseTarget);
  const [session, setSession] = useState<Session | null>(null);

  const enter = useCallback((next: Session) => {
    rememberChannel({
      channelId: next.channelId,
      name: next.channelName,
      code: next.code,
    });
    if (next.code) history.replaceState({}, "", `/j/${next.code}`);
    setSession(next);
  }, []);

  /** Переход в соседний канал: выход из текущего делает сам ChannelScreen. */
  const openChannel = useCallback(
    async (channel: RecentChannel) => {
      if (!channel.code) return;
      const displayName = myName() || "гость";
      const result = await requestJoin({ displayName, code: channel.code });
      enter({ ...result, displayName, code: channel.code });
    },
    [enter],
  );

  const newChannel = useCallback(async () => {
    const displayName = myName() || "гость";
    const created = await createChannel("Новый канал");
    const result = await requestJoin({ displayName, code: created.inviteCode });
    enter({ ...result, displayName, code: created.inviteCode });
  }, [enter]);

  if (session) {
    return (
      <ChannelScreen
        // Пересоздаём экран при смене канала: движок держит соединения и
        // переписку внутри, и переиспользовать его между каналами нельзя.
        key={session.channelId}
        channelId={session.channelId}
        channelName={session.channelName}
        token={session.token}
        selfName={session.displayName}
        onLeave={() => {
          setSession(null);
          history.pushState({}, "", "/");
        }}
        onOpenChannel={(channel) => void openChannel(channel)}
        onNewChannel={() => void newChannel()}
      />
    );
  }

  if (target) {
    return (
      <JoinScreen
        target={target}
        onJoined={(result) =>
          enter({ ...result, code: target.code ?? null })
        }
      />
    );
  }

  return <Landing />;
}

/** Корень без ссылки: единственное осмысленное действие — назвать комнату словом. */
function Landing() {
  const [word, setWord] = useState("");

  return (
    <div className="join">
      <form
        className="join__inner"
        onSubmit={(event) => {
          event.preventDefault();
          const slug = word.trim();
          if (slug) location.assign(`/r/${encodeURIComponent(slug)}`);
        }}
      >
        <div className="join__mark">B</div>
        <span className="join__kicker">Голосовые каналы без границ</span>
        <h1 className="join__channel">Badyum</h1>

        <input
          className="join__field"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="кодовое слово, например badyum-катка"
          maxLength={48}
          aria-label="Кодовое слово комнаты"
        />
        <p className="join__label">
          Назовите с другом одно и то же слово — окажетесь в одном канале
        </p>

        <button className="join__cta" type="submit" disabled={!word.trim()}>
          Создать канал
        </button>
        <p className="join__note">Регистрация не нужна — только имя</p>
      </form>
    </div>
  );
}
