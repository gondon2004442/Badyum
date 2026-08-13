interface IconProps {
  size?: number;
  className?: string;
}

/** Иконки те же, что в макете Figma: stroke-based, 24×24, currentColor. */
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const MicIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 11a7 7 0 0 1-14 0" />
    <path d="M12 18v3" />
  </svg>
);

export const MicOffIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M15 9.3V5a3 3 0 0 0-5.9-.7" />
    <path d="M9 9.2V11a3 3 0 0 0 4.6 2.5" />
    <path d="M19 11a7 7 0 0 1-1.1 3.8" />
    <path d="M5 11a7 7 0 0 0 10.3 6.2" />
    <path d="M12 18v3" />
    <path d="M3 3l18 18" />
  </svg>
);

export const HeadphonesIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <path d="M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2z" />
    <path d="M20 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z" />
  </svg>
);

export const SpeakerIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const LinkIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

export const ExitIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M9.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4.5" />
    <path d="M16 16.5 20.5 12 16 7.5" />
    <path d="M20.5 12H9" />
  </svg>
);

export const SlidersIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M5 21v-6M5 11V3M12 21v-9M12 8V3M19 21v-4M19 13V3" />
    <path d="M2.5 15h5M9.5 8h5M16.5 17h5" />
  </svg>
);

export const PhoneIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M6.5 3h-2A1.5 1.5 0 0 0 3 4.6C3 13 11 21 19.4 21a1.5 1.5 0 0 0 1.6-1.5v-2a1 1 0 0 0-.8-1l-3.3-.7a1 1 0 0 0-1 .4l-1 1.3a13.5 13.5 0 0 1-6.4-6.4l1.3-1a1 1 0 0 0 .4-1L9.5 3.8a1 1 0 0 0-1-.8Z" />
  </svg>
);

/** Тот же телефон, но положенный — «сбросить». */
export const PhoneOffIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M2.5 16.2a15 15 0 0 1 19 0" />
    <path d="M6.6 13.4 4.4 15.6a1.4 1.4 0 0 1-2 0l-.9-1a1.4 1.4 0 0 1 0-2" />
    <path d="M17.4 13.4l2.2 2.2a1.4 1.4 0 0 0 2 0l.9-1a1.4 1.4 0 0 0 0-2" />
    <path d="M8.5 12.4v2.2M15.5 12.4v2.2" />
  </svg>
);

/**
 * Логотип Google.
 *
 * Единственная иконка с собственными цветами: правила Google требуют
 * использовать фирменный знак как есть, а не перекрашивать под интерфейс.
 * Поэтому здесь fill, а не stroke, и base() не подходит.
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

/** Скрепка: приложить файл к сообщению. */
export const ClipIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
