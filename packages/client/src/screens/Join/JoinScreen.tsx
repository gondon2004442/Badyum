import { useEffect, useState, type FormEvent } from "react";
import { ApiError, previewChannel, requestJoin, type PreviewResponse } from "../../api.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { startLogin, nameOf, useAccount } from "../../account.ts";
import { GoogleIcon } from "../../components/Icons.tsx";
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
/**
 * Отказы, после которых ждать нечего.
 *
 * Их объединяет одно: канала за ссылкой нет и не появится, сколько ни жми.
 * Всё остальное — сеть отвалилась, сервер икнул — переживается повторной
 * попыткой, и ради этого экран ломать не надо.
 */
const DEAD = new Set(["not_found", "invite_expired", "invite_exhausted", "bad_input"]);

export function JoinScreen({ target, onJoined }: JoinScreenProps) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ссылка никуда не ведёт: приглашения показывать нечего. */
  const [dead, setDead] = useState(false);
  const { account, available } = useAccount();

  /**
   * Ник подставляем только в пустое поле: аккаунт приходит асинхронно, и
   * перезаписать им уже набранное имя означало бы стереть слово из-под рук.
   */
  useEffect(() => {
    if (account) setName((current) => current || nameOf(account));
  }, [account]);

  useEffect(() => {
    let cancelled = false;
    void previewChannel(target)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Не получилось открыть канал");
        // Ссылка мертва — за ней ничего нет и не появится. Это не та ошибка,
        // которую можно переждать, поэтому она меняет весь экран, а не
        // дописывает строчку под кнопкой.
        if (err instanceof ApiError && DEAD.has(err.code)) setDead(true);
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

  /**
   * Комнаты по такому слову ещё нет, и завести её гость не может: создание
   * закрыто входом, иначе запрет обходился бы случайным словом. Говорим об
   * этом сразу, а не после того, как человек введёт имя и нажмёт кнопку.
   *
   * Ссылка-приглашение сюда не попадает: за ней стоит существующий канал, и
   * гость по-прежнему заходит в него, введя одно имя.
   */
  const mustLogIn = preview?.exists === false && !account && available;

  /*
    Мёртвая ссылка получает свой экран, а не строчку под кнопкой.

    Раньше здесь показывалось полноценное приглашение: «Тебя зовут в голосовой
    канал», название «канал» вместо настоящего, обнадёживающее «Пока никого —
    зайди первым», поле для имени и рабочая с виду кнопка. Правду говорила одна
    мелкая красная строка под ними — и противоречила всему, что было выше.
    Человек вводил имя, жал кнопку и получал ту же ошибку второй раз.
  */
  if (dead) {
    return (
      <div className="join">
        <div className="join__inner">
          <div className="join__mark">B</div>
          <span className="join__kicker">Ссылка не работает</span>
          <h1 className="join__channel">Канала нет</h1>
          <p className="join__who">{error ?? "Такого канала нет — возможно, ссылка устарела"}</p>
          <button className="join__cta" type="button" onClick={() => { location.href = "/"; }}>
            На главную
          </button>
          <p className="join__note">Попроси новую ссылку у того, кто тебя звал</p>
        </div>
      </div>
    );
  }

  return (
    <div className="join">
      <form className="join__inner" onSubmit={submit}>
        <div className="join__mark">B</div>

        <span className="join__kicker">
          {/* «Тебя зовут» — про чужую ссылку. Свободное слово никто не звал. */}
          {mustLogIn ? "Комната по кодовому слову" : "Тебя зовут в голосовой канал"}
        </span>
        <h1 className="join__channel">{channelName}</h1>

        {inside.length > 0 ? (
          <div className="join__who">
            <div className="join__stack">
              {inside.slice(0, 3).map((p) => (
                <Avatar key={p.userId} userId={p.userId} name={p.displayName} />
              ))}
            </div>
            {describeInside(inside.map((p) => p.displayName))}
          </div>
        ) : (
          <div className="join__who">
            {mustLogIn ? "Такой комнаты ещё нет" : "Пока никого — зайди первым"}
          </div>
        )}

        {mustLogIn ? (
          <button
            className="join__cta join__cta--login"
            onClick={() => void startLogin()}
            type="button"
          >
            <GoogleIcon size={16} />
            Войти и создать комнату
          </button>
        ) : (
          <>
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
          </>
        )}

        {error ? <p className="join__error">{error}</p> : null}
        <p className="join__note">
          {account
            ? `Ты вошёл как ${nameOf(account)}`
            : mustLogIn
              ? "Заходить по чужой ссылке вход не нужен — только заводить свои комнаты"
              : "Регистрация не нужна — только имя"}
        </p>
      </form>
    </div>
  );
}

function describeInside(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(" и ");
  return `${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}`;
}
