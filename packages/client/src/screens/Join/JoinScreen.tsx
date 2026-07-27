import { useEffect, useState, type FormEvent } from "react";
import { ApiError, previewChannel, requestJoin, type PreviewResponse } from "../../api.ts";
import { Avatar } from "../../components/Avatar.tsx";
import "./Join.css";

export interface JoinTarget {
  code?: string;
  slug?: string;
}

interface JoinScreenProps {
  target: JoinTarget;
  onJoined: (result: {
    token: string;
    channelId: string;
    channelName: string;
    displayName: string;
  }) => void;
}

const NAME_KEY = "badyum:name";

/**
 * Приземление с инвайт-ссылки.
 *
 * Вся стоимость входа — имя. Никакой регистрации: барьер «зарегистрируйся,
 * чтобы поговорить» убивает такие проекты на старте. Нажатие кнопки заодно
 * служит тем пользовательским жестом, без которого iOS не даст звук.
 */
export function JoinScreen({ target, onJoined }: JoinScreenProps) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void previewChannel(target)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Не получилось открыть канал");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target.code, target.slug]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName || busy) return;

    setBusy(true);
    setError(null);
    try {
      const result = await requestJoin({ ...target, displayName });
      localStorage.setItem(NAME_KEY, displayName);
      onJoined({ ...result, displayName });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не получилось войти");
      setBusy(false);
    }
  };

  const channelName = preview?.channelName ?? target.slug ?? "канал";
  const inside = preview?.participants ?? [];

  return (
    <div className="join">
      <form className="join__inner" onSubmit={submit}>
        <div className="join__mark">B</div>

        <span className="join__kicker">Тебя зовут в голосовой канал</span>
        <h1 className="join__channel">{channelName}</h1>

        {inside.length > 0 ? (
          <div className="join__who">
            <div className="join__stack">
              {inside.slice(0, 3).map((p) => (
                <Avatar key={p.userId} userId={p.userId} />
              ))}
            </div>
            {describeInside(inside.map((p) => p.displayName))}
          </div>
        ) : (
          <div className="join__who">Пока никого — зайди первым</div>
        )}

        <input
          className="join__field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как тебя звать?"
          maxLength={32}
          autoFocus
          aria-label="Твоё имя в канале"
        />
        <p className="join__label">Как тебя будет видно в канале</p>

        <button className="join__cta" type="submit" disabled={!name.trim() || busy}>
          {busy ? "Подключаюсь…" : "Войти в канал"}
        </button>

        {error ? <p className="join__error">{error}</p> : null}
        <p className="join__note">Регистрация не нужна — только имя</p>
      </form>
    </div>
  );
}

function describeInside(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(" и ");
  return `${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}`;
}
