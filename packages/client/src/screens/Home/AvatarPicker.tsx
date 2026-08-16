import { useEffect, useRef, useState } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import { describeAvatar, removeAvatar, squareOf, uploadAvatar } from "../../avatar.ts";
import type { Account } from "../../account.ts";

interface AvatarPickerProps {
  account: Account;
  onClose: () => void;
  /** Новый адрес картинки: аватарка видна не только здесь. */
  onChanged: (avatarUrl: string | null) => void;
}

/**
 * Выбор аватарки.
 *
 * Показываем результат обрезки до отправки, а не после. Обрезка идёт по центру
 * — на фотографиях лицо почти всегда там, — но угадывает она не всегда, и
 * человек должен увидеть, что получится, прежде чем согласиться. Иначе он
 * узнаёт о неудачной обрезке, уже поставив её всем на обозрение.
 */
export function AvatarPicker({ account, onClose, onChanged }: AvatarPickerProps) {
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Своя ли сейчас картинка.
   *
   * Отличаем по адресу: свои лежат у нас, гугловые — на серверах Google.
   * Отдельного поля ради этого заводить не стали, признак и так однозначный.
   */
  const own = account.avatarUrl?.startsWith("/api/avatar/") ?? false;

  // Предпросмотр живёт на blob-ссылке, и отпускать её надо руками.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      const blob = await squareOf(file);
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      setProblem(describeAvatar(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await uploadAvatar(preview.blob));
      onClose();
    } catch (error) {
      setProblem(describeAvatar(error));
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await removeAvatar());
      onClose();
    } catch (error) {
      setProblem(describeAvatar(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="settings__backdrop" onClick={onClose} />
      <div className="picker" role="dialog" aria-label="Аватарка">
        <div className="settings__head">
          <span className="settings__title">Аватарка</span>
          <button className="settings__close" onClick={onClose} title="Закрыть" type="button">
            ×
          </button>
        </div>

        <div className="picker__body">
          {/* Крупно: именно так её увидят на плитке в канале. */}
          {preview ? (
            <img className="picker__face" src={preview.url} alt="" />
          ) : (
            <Avatar
              userId={account.id}
              name={account.displayName}
              src={account.avatarUrl}
              className="picker__face"
            />
          )}

          <p className="picker__hint">
            {preview
              ? "Так тебя будут видеть. Не нравится — выбери другую."
              : "Квадрат вырезается из середины, поэтому лучше подойдёт фотография, где лицо по центру."}
          </p>
        </div>

        {problem ? <p className="picker__problem">{problem}</p> : null}

        <input
          ref={fileRef}
          className="chat__file"
          type="file"
          accept="image/*"
          onChange={(e) => {
            void take(e.target.files?.[0]);
            // Иначе повторный выбор того же файла не даёт события.
            e.target.value = "";
          }}
          tabIndex={-1}
          aria-hidden
        />

        <div className="picker__acts">
          <button
            className="picker__pick"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            type="button"
          >
            {preview ? "Другая" : "Выбрать картинку"}
          </button>

          {preview ? (
            <button className="picker__save" onClick={() => void save()} disabled={busy} type="button">
              {busy ? "…" : "Поставить"}
            </button>
          ) : own ? (
            /*
              Только когда есть что убирать. «Убрать» снимает свою картинку, а
              не гугловую — та придёт обратно при следующем входе, потому что
              её обновляет сам Google. Показывать кнопку тому, у кого своей нет,
              значит обещать действие, которое ничего не изменит.
            */
            <button className="picker__drop" onClick={() => void drop()} disabled={busy} type="button">
              Убрать свою
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
