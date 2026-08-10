import { useEffect, useRef, useState, type FormEvent } from "react";
import { publicOrigin } from "../../api.ts";
import type { Account } from "../../account.ts";
import "./Username.css";

interface UsernameScreenProps {
  account: Account;
  /** Юз выбран — дальше всё как обычно. */
  onDone: (username: string) => void;
  /** Показывается только при смене: при первом выборе отступать некуда. */
  onCancel?: () => void;
}

/** Сколько ждать после последней буквы, прежде чем спрашивать «занято?». */
const CHECK_DELAY_MS = 400;

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "free" }
  | { state: "taken"; why: string };

/**
 * Выбор юза.
 *
 * Юз глобально уникален, и это единственное во всём сервисе, что человек не
 * может изменить, не отобрав у кого-то другого. Поэтому выбирается он один раз
 * осознанно, а не подставляется за него.
 *
 * «Занято» показывается пока человек печатает, а не после нажатия кнопки: иначе
 * подбор свободного юза превращается в череду отказов. Но полагаться на эту
 * проверку нельзя — между ответом и нажатием юз успевает занять другой, —
 * поэтому настоящий отказ приходит с сервера при сохранении, и он тоже
 * показывается словами.
 */
export function UsernameScreen({ account, onDone, onCancel }: UsernameScreenProps) {
  const [value, setValue] = useState(account.username ?? "");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Гонка ответов: медленный ответ на старый ввод не должен перебить новый. */
  const seq = useRef(0);

  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === account.username) {
      setCheck({ state: "idle" });
      return;
    }

    setCheck({ state: "checking" });
    const mine = ++seq.current;

    const timer = window.setTimeout(() => {
      void fetch(`${publicOrigin()}/api/username/check?u=${encodeURIComponent(trimmed)}`, {
        credentials: "include",
      })
        .then((r) => r.json() as Promise<{ free: boolean; why: string | null }>)
        .then((data) => {
          if (seq.current !== mine) return;
          setCheck(
            data.free
              ? { state: "free" }
              : { state: "taken", why: data.why ?? "Этот юз уже занят" },
          );
        })
        .catch(() => {
          // Сеть моргнула — молчим. Настоящую проверку всё равно делает
          // сохранение, и пугать человека раньше времени незачем.
          if (seq.current === mine) setCheck({ state: "idle" });
        });
    }, CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [value, account.username]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${publicOrigin()}/api/username`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = (await response.json()) as { username?: string; why?: string };

      if (!response.ok) {
        setError(data.why ?? "Не получилось");
        return;
      }
      onDone(data.username!);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setSaving(false);
    }
  };

  const blocked = check.state === "taken";

  return (
    <div className="pickname">
      <form className="pickname__card" onSubmit={submit}>
        <span className="pickname__kicker">
          {account.username ? "Смена юза" : "Последний шаг"}
        </span>
        <h1 className="pickname__title">Придумай юз</h1>
        <p className="pickname__lead">
          По нему тебя найдут и добавят в контакты. Его диктуют вслух, поэтому
          латиница, цифры, точка и подчёркивание — и он у всех разный.
        </p>

        <div className="pickname__field">
          <span className="pickname__at">@</span>
          <input
            className="pickname__input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="dumax"
            maxLength={20}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Твой юз"
          />
        </div>

        <p
          className={`pickname__hint${blocked || error ? " pickname__hint--bad" : ""}${
            check.state === "free" ? " pickname__hint--good" : ""
          }`}
        >
          {error ??
            (check.state === "taken"
              ? check.why
              : check.state === "free"
                ? "Свободен"
                : check.state === "checking"
                  ? "Проверяю…"
                  : "От трёх до двадцати символов")}
        </p>

        <div className="pickname__acts">
          {onCancel ? (
            <button className="pickname__later" onClick={onCancel} type="button">
              Отмена
            </button>
          ) : null}
          <button
            className="pickname__go"
            type="submit"
            disabled={!value.trim() || saving || blocked}
          >
            {saving ? "Сохраняю…" : "Занять"}
          </button>
        </div>
      </form>
    </div>
  );
}
