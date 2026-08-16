import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { Crop } from "../../avatar.ts";

/** Сторона окна кадрирования в пикселях страницы. */
const VIEW = 240;
/** Дальше увеличивать бессмысленно: пиксели исходника уже видны. */
const MAX_ZOOM = 4;

interface AvatarCropProps {
  image: HTMLImageElement;
  /** Текущий выбор в пикселях исходника. Зовётся на каждое движение. */
  onChange: (crop: Crop) => void;
}

interface View {
  /** Во сколько раз увеличено сверх «вписать по короткой стороне». */
  zoom: number;
  /** Левый верхний угол картинки относительно окна, в пикселях страницы. */
  x: number;
  y: number;
}

/**
 * Кадрирование аватарки.
 *
 * Раньше квадрат вырезался из середины автоматически. Это работает ровно до
 * первой фотографии, где человек стоит сбоку, — а таких большинство.
 *
 * Окно квадратное и неподвижное, двигается и масштабируется сама картинка:
 * так понятнее, что именно станет аватаркой, и не приходится тянуть за углы
 * рамки, что на телефоне пальцем почти невозможно.
 */
export function AvatarCrop({ image, onChange }: AvatarCropProps) {
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  /** Активные касания: два одновременно — это щипок. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  /**
   * Масштаб, при котором картинка ровно закрывает окно.
   *
   * Всё остальное считается от него, поэтому пустых полей по краям не бывает
   * никогда: увеличить можно, уменьшить ниже этого — нет.
   */
  const base = Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight);

  /** Не даём утащить картинку так, чтобы в окне появилась пустота. */
  const clamp = useCallback(
    (next: View): View => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom));
      const scale = base * zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;

      return {
        zoom,
        x: Math.min(0, Math.max(VIEW - width, next.x)),
        y: Math.min(0, Math.max(VIEW - height, next.y)),
      };
    },
    [base, image.naturalWidth, image.naturalHeight],
  );

  // Стартуем по центру — как раньше делала автоматическая обрезка. Для половины
  // фотографий этого достаточно, и трогать ничего не придётся.
  useEffect(() => {
    setView(
      clamp({
        zoom: 1,
        x: (VIEW - image.naturalWidth * base) / 2,
        y: (VIEW - image.naturalHeight * base) / 2,
      }),
    );
  }, [clamp, base, image.naturalWidth, image.naturalHeight]);

  // Сообщаем выбор наверх: окно в пикселях страницы переводим в пиксели
  // исходника — рисовать в canvas надо именно ими.
  useEffect(() => {
    const scale = base * view.zoom;
    onChange({ x: -view.x / scale, y: -view.y / scale, size: VIEW / scale });
  }, [view, base, onChange]);

  const centre = () => {
    const box = boxRef.current?.getBoundingClientRect();
    return { left: box?.left ?? 0, top: box?.top ?? 0 };
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const touches = [...pointers.current.values()];

    if (touches.length >= 2) {
      // Щипок: расстояние между пальцами задаёт увеличение.
      const [a, b] = touches as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);

      if (!pinch.current) {
        pinch.current = { distance, zoom: view.zoom };
        return;
      }

      const ratio = distance / (pinch.current.distance || 1);
      zoomAround(
        pinch.current.zoom * ratio,
        (a.x + b.x) / 2 - centre().left,
        (a.y + b.y) / 2 - centre().top,
      );
      return;
    }

    pinch.current = null;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  /**
   * Увеличить, оставив на месте точку под курсором или между пальцами.
   *
   * Без этого картинка при зуме уползает: увеличение от угла ощущается как
   * будто редактор живёт своей жизнью.
   */
  const zoomAround = (nextZoom: number, px: number, py: number) => {
    setView((v) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      const ratio = clamped / v.zoom;
      return clamp({
        zoom: clamped,
        x: px - (px - v.x) * ratio,
        y: py - (py - v.y) * ratio,
      });
    });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const box = centre();
    zoomAround(
      view.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
      event.clientX - box.left,
      event.clientY - box.top,
    );
  };

  const scale = base * view.zoom;

  return (
    <div className="crop">
      <div
        ref={boxRef}
        className="crop__box"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <img
          className="crop__img"
          src={image.src}
          alt=""
          draggable={false}
          style={{
            width: image.naturalWidth * scale,
            height: image.naturalHeight * scale,
            transform: `translate(${view.x}px, ${view.y}px)`,
          }}
        />
      </div>

      {/*
        Ползунок рядом с щипком, а не вместо него: на компьютере без мыши с
        колесом иначе не увеличить, а на телефоне им удобнее подкручивать
        точно, чем ловить нужный масштаб пальцами.
      */}
      <input
        className="crop__zoom"
        type="range"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={view.zoom}
        onChange={(e) => zoomAround(Number(e.target.value), VIEW / 2, VIEW / 2)}
        aria-label="Приблизить"
      />
    </div>
  );
}
