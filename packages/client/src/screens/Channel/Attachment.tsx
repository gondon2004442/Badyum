import { formatBytes, type Attachment } from "@badyum/shared";
import { ClipIcon } from "../../components/Icons.tsx";
import { apiOrigin } from "../../api.ts";

/** Куда браузеру идти за файлом. Канал в пути — часть ключа, а не украшение. */
export const fileUrl = (channelId: string, id: string): string =>
  `${apiOrigin()}/api/file/${encodeURIComponent(channelId)}/${encodeURIComponent(id)}`;

interface AttachmentViewProps {
  attachment: Attachment;
  channelId: string;
}

/**
 * Вложение в сообщении.
 *
 * Картинку показываем сразу, всё остальное — карточкой со скачиванием. Тип
 * решает сервер по содержимому файла: подпись клиента здесь не участвует
 * вовсе, иначе html со скриптом приехал бы под видом картинки.
 */
export function AttachmentView({ attachment, channelId }: AttachmentViewProps) {
  const href = fileUrl(channelId, attachment.id);

  if (attachment.kind === "image") {
    return (
      <a
        className="att att--image"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title={`${attachment.name} · ${formatBytes(attachment.size)}`}
      >
        <img
          className="att__img"
          src={href}
          alt={attachment.name}
          /*
            Размеры знаем заранее — их прислал отправитель. Без них картинка
            занимает нулевую высоту до загрузки, а потом раздвигает переписку,
            и человек теряет строку, которую читал.
          */
          width={attachment.width}
          height={attachment.height}
          loading="lazy"
          decoding="async"
        />
      </a>
    );
  }

  return (
    <a
      className="att att--file"
      href={href}
      /*
        download не ставим: сервер и так отдаёт файл с
        `Content-Disposition: attachment`, и это решение принимается там, где
        известен настоящий тип содержимого, а не здесь.
      */
      target="_blank"
      rel="noreferrer noopener"
    >
      <ClipIcon size={16} className="att__icon" />
      <span className="att__name">{attachment.name}</span>
      <span className="att__size">{formatBytes(attachment.size)}</span>
    </a>
  );
}
