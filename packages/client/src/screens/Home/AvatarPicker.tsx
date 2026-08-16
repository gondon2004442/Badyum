import { useEffect, useRef, useState } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import {
  describeAvatar,
  openImage,
  removeAvatar,
  renderSquare,
  uploadAvatar,
  type Crop,
} from "../../avatar.ts";
import { AvatarCrop } from "./AvatarCrop.tsx";
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
  /** Открытая картинка и способ отпустить её blob-ссылку. */
  const [source, setSource] = useState<{ image: HTMLImageElement; release: () => void } | null>(null);
  /** Что из неё выбрано. Меняется на каждое движение в редакторе. */
  const cropRef = useRef<Crop | null>(null);
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

  // blob-ссылку отпускаем руками, иначе каждая примеренная и отвергнутая
  // фотография остаётся висеть в памяти вкладки.
  useEffect(() => {
    const release = source?.release;
    return () => release?.();
  }, [source]);

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
      const opened = await openImage(file);
      // Прежнюю отпускаем сами: смена картинки не размонтирует компонент, и
      // эффект очистки тут не сработает.
      source?.release();
      cropRef.current = null;
      setSource(opened);
    } catch (error) {
      setProblem(describeAvatar(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!source || !cropRef.current) return;
    setBusy(true);
    setProblem(null);
    try {
      const square = await renderSquare(source.image, cropRef.current);
      onChanged(await uploadAvatar(square));
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
          {source ? (
            <AvatarCrop
              // key по картинке: у новой свои размеры, и начинать надо заново.
              key={source.image.src}
              image={source.image}
              onChange={(crop) => {
                cropRef.current = crop;
              }}
            />
          ) : (
            <Avatar
              userId={account.id}
              name={account.displayName}
              src={account.avatarUrl}
              className="picker__face"
            />
          )}

          <p className="picker__hint">
            {source
              ? "Двигай картинку и приближай — в квадрат попадёт то, что видно."
              : "Выбери фотографию: дальше можно будет подвинуть и приблизить."}
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
            {source ? "Другая" : "Выбрать картинку"}
          </button>

          {source ? (
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
