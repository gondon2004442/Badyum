import { useEffect, useRef } from "react";
import { formatBytes, type Attachment } from "@badyum/shared";

interface LightboxProps {
  attachment: Attachment;
  src: string;
  onClose: () => void;
}

/**
 * Картинка во весь экран, не покидая приложения.
 *
 * Раньше картинка была ссылкой с `target="_blank"`. На телефоне это стоило
 * человеку канала: браузер уводил со страницы (а то и выгружал вкладку), и
 * возврат означал свежую загрузку приложения — то есть вылет из разговора.
 * Смотреть присланный скриншот не должно стоить звонка.
 *
 * Поэтому здесь наложение поверх приложения: страница остаётся той же, сокет
 * живой, звук идёт.
 */
export function Lightbox({ attachment, src, onClose }: LightboxProps) {
  /*
    Обработчик держим в ref, а эффект вешаем один раз на всю жизнь просмотра.
    Иначе он зависел бы от onClose, который вызывающий создаёт заново на каждом
    рендере, — и любое новое сообщение в чате перезапускало бы эффект. В его
    очистке стоит history.back(), тот вызывает popstate, и просмотр закрывался
    сам. Со стороны это выглядело как «картинку выкидывает».
  */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);

    /*
      На телефоне закрывают «назад», а не крестиком. Кладём в историю запись,
      чтобы этот «назад» закрыл просмотр, а не увёл со страницы — иначе мы
      возвращаемся ровно к той беде, от которой уходим.
    */
    history.pushState({ badyumLightbox: true }, "");
    const onPop = () => closeRef.current();
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      // Закрыли крестиком — лишнюю запись надо убрать самим, иначе следующий
      // «назад» съест не то.
      if (history.state?.badyumLightbox) history.back();
    };
    // Пустые зависимости намеренно: эффект про жизнь просмотра, а не про то,
    // какой именно обработчик закрытия сейчас в пропсах.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={attachment.name}>
      <div className="lightbox__bar">
        <span className="lightbox__name">{attachment.name}</span>
        <span className="lightbox__size">{formatBytes(attachment.size)}</span>
        {/*
          Ссылка «открыть отдельно» осталась, но теперь это осознанный выбор, а
          не единственный способ разглядеть картинку. stopPropagation — иначе
          клик по ней закроет просмотр раньше, чем сработает переход.
        */}
        <a
          className="lightbox__open"
          href={src}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
        >
          Открыть отдельно
        </a>
        <button className="lightbox__close" onClick={onClose} title="Закрыть" type="button">
          ×
        </button>
      </div>

      {/*
        Обёртка нужна, чтобы вокруг картинки оставалось место, по которому можно
        закрыть кликом. Без неё картинка растягивалась на всю ширину и
        перехватывала клик «мимо» — закрыть по фону было физически негде.
      */}
      <div className="lightbox__area">
        <img
          className="lightbox__img"
          src={src}
          alt={attachment.name}
          // Клик по самой картинке не закрывает: в неё целятся, чтобы рассмотреть.
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
