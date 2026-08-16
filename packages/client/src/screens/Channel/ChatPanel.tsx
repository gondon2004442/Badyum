import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { ATTACHMENT_MAX_BYTES, formatBytes, type Attachment, type ChatMessage } from "@badyum/shared";
import { Avatar } from "../../components/Avatar.tsx";
import { ClipIcon } from "../../components/Icons.tsx";
import type { TypingPeer } from "../../voice/VoiceEngine.ts";
import { describeUpload } from "../../voice/uploadError.ts";
import { AttachmentView } from "./Attachment.tsx";

interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string | null;
  onSend: (text: string, attachment?: Attachment) => void;
  typing: TypingPeer[];
  onTyping: (typing: boolean) => void;
  /** «Написать в канал» — не то, что хочется видеть в переписке с человеком. */
  placeholder?: string;
  /** Чем встречает пустой чат: у канала и у переписки это разные вещи. */
  empty?: string;
  /**
   * Куда класть файлы. Без него скрепки нет вовсе: кнопка, которая ответит
   * «не настроено», хуже отсутствующей.
   */
  onUpload?: (file: File, size?: { width: number; height: number }) => Promise<Attachment>;
  /** Нужен, чтобы собрать адрес файла: канал — часть ключа в хранилище. */
  channelId?: string;
  /**
   * Аватарки по userId.
   *
   * Берутся из состава канала, а не из самого сообщения: хранить картинку в
   * каждой строке истории значило бы дублировать её сотню раз. У того, кто уже
   * вышел, останутся инициалы — и это честно, мы про него больше ничего не
   * знаем.
   */
  avatars?: Map<string, string | null>;
}

/**
 * Размеры картинки до отправки.
 *
 * Нужны получателю, чтобы место под картинку было занято заранее и переписка
 * не прыгала при её загрузке. Не получилось — не беда: без размеров картинка
 * просто дёрнет вёрстку один раз.
 */
async function measure(file: File): Promise<{ width: number; height: number } | undefined> {
  if (!file.type.startsWith("image/")) return undefined;

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(undefined);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * «Макс печатает…», «Макс и Коля печатают…», «Печатают трое».
 *
 * Имена перечисляем только пока их мало: строка живёт в одну строку под чатом,
 * и список из пяти имён её распирает.
 */
function typingLabel(who: TypingPeer[]): string | null {
  const names = who.map((w) => w.displayName);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} печатает…`;
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают…`;
  return `Печатают ${names.length}`;
}

/** Сообщения одного человека подряд — одной группой, без повтора имени. */
function groupsOf(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];

  for (const message of messages) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    const prev = last?.[last.length - 1];

    const sameAuthor = head?.userId === message.userId;
    // Пять минут — примерно та пауза, после которой это уже другой разговор.
    const soonAfter = prev !== undefined && message.at - prev.at < 5 * 60_000;

    if (last && sameAuthor && soonAfter) last.push(message);
    else groups.push([message]);
  }

  return groups;
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({
  messages,
  selfId,
  onSend,
  typing,
  onTyping,
  placeholder = "Написать в канал",
  empty = "Здесь можно написать, когда говорить не с руки — скинуть ссылку или ответить, не перебивая.",
  onUpload,
  channelId,
  avatars,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  /** Файл выбран, но ещё не отправлен: висит над полем, пока не нажмут ↵. */
  const [pending, setPending] = useState<{ file: File; preview: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Над панелью держат файл — подсвечиваем, что бросать можно сюда. */
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pinnedRef = useRef(true);

  // Предпросмотр живёт на blob-ссылке, и её надо отпускать руками: иначе
  // каждый выбранный и передуманный файл остаётся висеть в памяти вкладки.
  useEffect(() => {
    const url = pending?.preview;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pending]);

  // Прокручиваем вниз только если человек и так внизу. Иначе новое сообщение
  // выдёргивало бы его из середины переписки, которую он читает.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const onScroll = () => {
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      pinnedRef.current = distance < 80;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  /**
   * Взять файл откуда угодно: из диалога, из буфера, из перетаскивания.
   *
   * Ничего никуда не грузим прямо здесь: файл ждёт над полем, пока человек не
   * отправит сообщение. Так подпись и картинка уходят одним сообщением, и так
   * передумавший не оставляет за собой мусор в хранилище.
   */
  const take = (file: File) => {
    setProblem(null);

    if (file.size > ATTACHMENT_MAX_BYTES) {
      setProblem(`«${file.name}» — ${formatBytes(file.size)}, а можно до 10 МБ`);
      return;
    }

    setPending({
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    });
  };

  const drop = (file: File | undefined) => {
    if (file) take(file);
  };

  const onPaste = (event: ClipboardEvent) => {
    // Скриншот из буфера — основной способ приложить картинку, и он не должен
    // требовать похода в диалог выбора файла.
    const item = [...event.clipboardData.files][0];
    if (item) {
      event.preventDefault();
      take(item);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    drop([...event.dataTransfer.files][0]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if ((!value && !pending) || busy) return;

    let attachment: Attachment | undefined;

    if (pending && onUpload) {
      setBusy(true);
      setProblem(null);
      try {
        attachment = await onUpload(pending.file, await measure(pending.file));
      } catch (error) {
        // Текст сообщения не трогаем: человек его написал, и терять его из-за
        // неудачной загрузки нельзя.
        setProblem(describeUpload(error));
        return;
      } finally {
        setBusy(false);
      }
    }

    onSend(value, attachment);
    setText("");
    setPending(null);
    // Отправил — значит допечатал. Иначе надпись у остальных висела бы ещё
    // несколько секунд после того, как сообщение уже пришло.
    onTyping(false);
    pinnedRef.current = true;
  };

  /**
   * Пустое поле — это «перестал печатать», а не «печатает пустоту». Человек,
   * стерший всё написанное, передумал, и остальным это видно сразу.
   */
  const onInput = (value: string) => {
    setText(value);
    onTyping(value.trim().length > 0);
  };

  const groups = groupsOf(messages);
  const label = typingLabel(typing);

  return (
    <section className="chat">
      <div className="chat__list" ref={listRef}>
        {groups.length === 0 ? (
          <p className="chat__empty">{empty}</p>
        ) : (
          groups.map((group) => {
            const head = group[0]!;
            const mine = head.userId === selfId;

            return (
              <div key={head.id} className={`msg ${mine ? "msg--mine" : ""}`}>
                <Avatar
                  userId={head.userId}
                  name={head.displayName}
                  src={avatars?.get(head.userId)}
                  className="msg__avatar"
                />
                <div className="msg__body">
                  <div className="msg__head">
                    <span className="msg__author">{head.displayName}</span>
                    <span className="msg__time">{time(head.at)}</span>
                  </div>
                  {group.map((message) => (
                    <div key={message.id} className="msg__row">
                      {/* Текста может не быть вовсе: картинка без подписи —
                          обычное сообщение, а пустой абзац занимал бы место. */}
                      {message.text ? <p className="msg__text">{message.text}</p> : null}
                      {message.attachment && channelId ? (
                        <AttachmentView
                          attachment={message.attachment}
                          channelId={channelId}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {label ? <div className="chat__typing">{label}</div> : null}

      {problem ? <div className="chat__problem">{problem}</div> : null}

      {/* Файл ждёт отправки. Показываем его до поля, а не после: он уйдёт
          вместе с тем, что человек сейчас печатает. */}
      {pending ? (
        <div className="chat__pending">
          {pending.preview ? (
            <img className="chat__pending-img" src={pending.preview} alt="" />
          ) : (
            <ClipIcon size={16} className="chat__pending-icon" />
          )}
          <span className="chat__pending-name">{pending.file.name}</span>
          <span className="chat__pending-size">{formatBytes(pending.file.size)}</span>
          <button
            className="chat__pending-drop"
            onClick={() => setPending(null)}
            title="Убрать файл"
            type="button"
            disabled={busy}
          >
            ×
          </button>
        </div>
      ) : null}

      <form
        className={`chat__compose${dragging ? " chat__compose--drop" : ""}`}
        onSubmit={(e) => void submit(e)}
        onDragOver={(e) => {
          if (!onUpload) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {onUpload ? (
          <>
            <input
              ref={fileRef}
              className="chat__file"
              type="file"
              onChange={(e) => {
                drop(e.target.files?.[0]);
                // Сбрасываем значение: иначе повторный выбор того же файла
                // не даёт события, и приложить его второй раз нечем.
                e.target.value = "";
              }}
              tabIndex={-1}
              aria-hidden
            />
            <button
              className="chat__clip"
              onClick={() => fileRef.current?.click()}
              title="Приложить файл"
              type="button"
              disabled={busy}
            >
              <ClipIcon size={17} />
            </button>
          </>
        ) : null}

        <input
          className="chat__input"
          value={text}
          onChange={(e) => onInput(e.target.value)}
          onPaste={onUpload ? onPaste : undefined}
          placeholder={pending ? "Подпись, если нужна" : placeholder}
          maxLength={2000}
          aria-label="Сообщение в канал"
        />
        <button
          className="chat__send"
          type="submit"
          disabled={(!text.trim() && !pending) || busy}
        >
          {busy ? "…" : "↵"}
        </button>
      </form>
    </section>
  );
}
