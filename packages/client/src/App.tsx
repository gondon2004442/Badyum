import { useCallback, useState } from "react";
import { JoinScreen, type JoinTarget } from "./screens/Join/JoinScreen.tsx";
import { ChannelScreen } from "./screens/Channel/ChannelScreen.tsx";
import { HomeScreen } from "./screens/Home/HomeScreen.tsx";
import { ApiError, createChannel, fetchInviteCode, requestJoin } from "./api.ts";
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
  const [target, setTarget] = useState<JoinTarget | null>(parseTarget);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = useCallback((next: Session) => {
    rememberChannel({
      channelId: next.channelId,
      name: next.channelName,
      code: next.code,
    });
    if (next.code) history.replaceState({}, "", `/j/${next.code}`);
    setSession(next);
  }, []);

  /**
   * Любой вход в канал. Ошибку показываем словами: «ничего не произошло» после
   * нажатия выглядит как поломка, а канал мог просто исчезнуть.
   */
  const go = useCallback(
    async (run: () => Promise<Session>) => {
      setBusy(true);
      setError(null);
      try {
        enter(await run());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Не получилось войти в канал");
      } finally {
        setBusy(false);
      }
    },
    [enter],
  );

  /** Переход в соседний канал: выход из текущего делает сам ChannelScreen. */
  const openChannel = useCallback(
    (channel: RecentChannel) => {
      if (!channel.code) return;
      void go(async () => {
        const displayName = myName() || "гость";
        const code = channel.code!;
        const result = await requestJoin({ displayName, code });
        return { ...result, displayName, code };
      });
    },
    [go],
  );

  const newChannel = useCallback(() => {
    void go(async () => {
      const displayName = myName() || "гость";
      const created = await createChannel("Новый канал");
      const result = await requestJoin({ displayName, code: created.inviteCode });
      return { ...result, displayName, code: created.inviteCode };
    });
  }, [go]);

  const openWord = useCallback(
    (word: string) => {
      void go(async () => {
        const displayName = myName() || "гость";
        const result = await requestJoin({ displayName, slug: word });
        // У канала по слову инвайта может не быть — попросим его отдельно,
        // иначе в «недавних» окажется строка, по которой не вернуться.
        const invite = await fetchInviteCode(result.channelId).catch(() => null);
        return { ...result, displayName, code: invite?.code ?? null };
      });
    },
    [go],
  );

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
          // Цель из адреса тоже сбрасываем: иначе выход из канала возвращал бы
          // на экран входа в него же вместо домашнего.
          setTarget(null);
          history.pushState({}, "", "/");
        }}
        onOpenChannel={openChannel}
        onNewChannel={newChannel}
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

  return (
    <HomeScreen
      onOpenChannel={openChannel}
      onNewChannel={newChannel}
      onOpenWord={openWord}
      busy={busy}
      error={error}
    />
  );
}
