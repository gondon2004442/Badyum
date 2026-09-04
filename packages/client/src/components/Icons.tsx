interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Иконки — Material Symbols Outlined, тот же набор, что в макетах.
 *
 * Шрифт лежит рядом с приложением и обрезан до тех иконок, которые мы правда
 * рисуем: сорок с небольшим глифов вместо четырёх тысяч, восемь килобайт
 * вместо семисот. Обрезка убирает лигатуры, поэтому символ задаётся кодом, а
 * не словом «mic» — отсюда таблица ниже, она же список всего, что доступно.
 */
const GLYPH = {
  mic: "\ue31d",
  mic_off: "\ue02b",
  headphones: "\uf01f",
  headset_off: "\ue33a",
  volume_up: "\ue050",
  graphic_eq: "\ue1b8",
  link: "\ue250",
  add_link: "\ue178",
  logout: "\ue9ba",
  tune: "\ue429",
  call: "\uf0d4",
  call_end: "\uf0bc",
  call_missed: "\ue0b4",
  attach_file: "\ue226",
  present_to_all: "\ue0df",
  cancel_presentation: "\ue0e9",
  forum: "\ue8af",
  search: "\uef7a",
  edit_square: "\uf88d",
  person_add: "\uea4d",
  photo_camera: "\ue412",
  badge: "\uea67",
  noise_control_off: "\uebf3",
  picture_in_picture: "\ue8aa",
  unfold_more: "\ue5d7",
  verified: "\uef76",
  play_arrow: "\ue037",
  mood: "\uea22",
  send: "\ue163",
  image: "\ue3f4",
  reply: "\ue15e",
  done_all: "\ue877",
  more_horiz: "\ue5d3",
  close: "\ue5cd",
  arrow_back: "\ue5c4",
  cast: "\ue307",
  group: "\uea21",
  check: "\ue668",
  content_copy: "\ue14d",
  qr_code_2: "\ue00a",
  expand_more: "\ue5cf",
  settings: "\ue8b8",
} as const;

export type IconName = keyof typeof GLYPH;

/**
 * Иконка по имени. Размер задаётся кеглем, цвет наследуется от текста, так что
 * иконка ведёт себя как буква и не требует ни fill, ни stroke.
 */
export function Icon({
  name,
  size = 20,
  className,
}: IconProps & { name: IconName }) {
  return (
    <span
      className={className ? `icon ${className}` : "icon"}
      style={{ fontSize: size }}
      aria-hidden
    >
      {GLYPH[name]}
    </span>
  );
}

/*
 * Именованные иконки. Экраны зовут их по смыслу — «микрофон», «выйти», — и
 * менять сам набор можно здесь, не трогая ни один экран.
 */
const named =
  (name: IconName, defaultSize = 20) =>
  ({ size = defaultSize, className }: IconProps) => <Icon name={name} size={size} className={className} />;

export const MicIcon = named("mic");
export const MicOffIcon = named("mic_off");
export const HeadphonesIcon = named("headphones");
export const HeadphonesOffIcon = named("headset_off");
export const SpeakerIcon = named("volume_up");
export const WaveIcon = named("graphic_eq");
export const LinkIcon = named("link");
export const ExitIcon = named("logout");
export const SlidersIcon = named("tune");
export const PhoneIcon = named("call");
export const PhoneOffIcon = named("call_end");
export const ClipIcon = named("attach_file", 18);
export const ScreenIcon = named("present_to_all");
export const ScreenOffIcon = named("cancel_presentation");
export const ChatIcon = named("forum");
export const SendIcon = named("send");
export const CopyIcon = named("content_copy");
export const QrIcon = named("qr_code_2");
export const CloseIcon = named("close", 18);
export const BackIcon = named("arrow_back");
export const CameraIcon = named("photo_camera");
export const PeopleIcon = named("group");
export const CheckIcon = named("check", 16);
/** Шеврон у строки профиля: подсказывает, что за ней раскрывается меню. */
export const ChevronIcon = named("unfold_more", 18);
/** Завести канал. Не просто «плюс»: канал заводится вместе со ссылкой на него. */
export const AddChannelIcon = named("add_link");
/** Подтверждённый вход: рядом с тем, через что человек вошёл. */
export const VerifiedIcon = named("verified", 14);
/** Имя как удостоверение — им человек представляется остальным. */
export const BadgeIcon = named("badge", 18);
/** Шумодав. */
export const NoiseIcon = named("noise_control_off", 18);
/** Панель поверх игры. */
export const OverlayIcon = named("picture_in_picture", 18);

/**
 * Логотип Google — исключение. Гайдлайн Google Identity требует использовать
 * фирменный знак как есть, а не перекрашивать под интерфейс, поэтому здесь
 * настоящий SVG с четырьмя фирменными цветами.
 */
export const GoogleIcon = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    aria-hidden
  >
    <path
      fill="#4285F4"
      d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.5 5.5 0 0 1-2.4 3.62v3h3.87c2.26-2.09 3.56-5.17 3.56-8.86z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3a7.2 7.2 0 0 1-4.07 1.16c-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a12 12 0 0 0 0 10.76l3.99-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75z"
    />
  </svg>
);
