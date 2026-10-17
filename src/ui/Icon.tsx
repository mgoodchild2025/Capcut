const PATHS: Record<string, string> = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  replay: 'M4 4v5h5M4.6 9A8 8 0 1 1 4 13',
  undo: 'M9 7H5V3M5.5 7.5A8 8 0 1 1 4 13',
  redo: 'M15 7h4V3M18.5 7.5A8 8 0 1 0 20 13',
  split: 'M12 3v18M7 7l-3 5 3 5M17 7l3 5-3 5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  media: 'M3 5h18v14H3zM10 9.5v5l4.5-2.5z',
  audio: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  captions: 'M3 5h18v14H3zM7 15h4M13 15h4M7 11h10',
  sticker: 'M12 21a9 9 0 1 1 9-9v1l-8 8zM8.5 10h.01M15.5 10h.01M8.5 14.5a4.5 4.5 0 0 0 7 0',
  filter: 'M9 13a6 6 0 1 0 0-.01M15 13a6 6 0 1 0 0-.01M12 7.5a6 6 0 1 0 .01 0',
  transition: 'M4 5h7v14H4zM13 5h7v14h-7zM9 12h6M13 10l2 2-2 2',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  plus: 'M12 5v14M5 12h14',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6M11 8v6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 5M22 9l-5 5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
  share: 'M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1',
  export: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  home: 'M3 11l9-8 9 8M5 9.5V21h14V9.5',
  close: 'M6 6l12 12M18 6L6 18',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  stepBack: 'M18 6v12L9 12zM6 6v12',
  stepFwd: 'M6 6v12l9-6zM18 6v12',
  fit: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4',
  check: 'M5 12l5 5 9-10',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  speed: 'M12 14l4-5M4 18a9 9 0 1 1 16 0',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  folder: 'M3 6h6l2 2h10v11H3z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  freeze: 'M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  reverse: 'M11 5L4 12l7 7M20 5l-7 7 7 7',
  detach: 'M3 12h4l3-6 4 12 3-6h4M3 20h18',
  paste: 'M9 4h6v3H9zM8 5H5v15h14V5h-3M9 12h6M9 16h4',
  flipH: 'M12 3v18M8 7L3 12l5 5zM16 7l5 5-5 5z',
  flipV: 'M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z',
  eyedropper: 'M15 4l5 5-3 1-7 7H7v-3l7-7zM4 20l3-3',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v3M12 19v3M2 12h3M19 12h3',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  marker: 'M6 3h12v13l-6 5-6-5z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM21 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  wand: 'M4 20L16 8M14 4v3M18 6h3M19 10v2M10 5h2M16 8l-2-2',
  template: 'M3 4h18v6H3zM3 14h8v6H3zM15 14h6v6h-6z',
  volleyball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3a14 14 0 0 1 0 9M12 12l7.8 4.5M12 12l-7.8 4.5M5 6.5a14 14 0 0 1 7 5.5M19 6.5A14 14 0 0 0 9 12',
  beat: 'M3 12h3l2-6 3 12 3-9 2 3h5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
};

export function Icon({ name, size = 18, className, fill }: { name: string; size?: number; className?: string; fill?: boolean }) {
  const solid = fill ?? (name === 'play' || name === 'pause' || name === 'stepBack' || name === 'stepFwd');
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
