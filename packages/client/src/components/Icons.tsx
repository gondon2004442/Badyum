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
