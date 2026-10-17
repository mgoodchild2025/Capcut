export type AssetKind = 'video' | 'audio' | 'image';

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  /** Object URL for the underlying blob. Not persisted. */
  url: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  hasAudio: boolean;
  thumbnail?: string;
  /** Evenly spaced frames across the source, as data URLs. */
  filmstrip?: string[];
  /** Normalised peak values (0..1), WAVEFORM_RATE per second of source. */
  waveform?: number[];
}

/** Timeline track kinds. Video tracks hold video/image clips, text tracks hold text/sticker clips. */
export type TrackKind = 'video' | 'text' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  /** The main video track cannot be deleted and sits at the bottom of the visual stack. */
  main?: boolean;
  /** Holds auto-generated captions; regenerated captions replace this track's clips. */
  captions?: boolean;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'sticker';

export interface Transform {
  /** Centre offset from canvas centre, as a fraction of canvas width. */
  x: number;
  /** Centre offset from canvas centre, as a fraction of canvas height. */
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  opacity: number;
}

export interface Adjust {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  hue: number; // -180..180
  blur: number; // 0..20
  vignette: number; // 0..100
}

export type AnimKind =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'spin'
  | 'pop';

export type TransitionKind =
  | 'none'
  | 'dissolve'
  | 'fade-black'
  | 'slide-left'
  | 'slide-up'
  | 'wipe-right'
  | 'zoom'
  | 'blur';

export interface TextStyle {
  content: string;
  fontFamily: string;
  /** Pixels at a 1080px-tall canvas; scaled with the project resolution. */
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  background: string | null;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  shadow: boolean;
}

export interface CaptionWord {
  text: string;
  /** Start and end in clip source time: `inPoint + local * speed`, so splitting a caption keeps timings valid. */
  start: number;
  end: number;
}

export interface Caption {
  words: CaptionWord[];
  /** Colour of the word being spoken, or null for no word highlight. */
  highlight: string | null;
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  name: string;
  assetId?: string;
  /** Timeline position in seconds. */
  start: number;
  /** Timeline length in seconds (already accounts for speed). */
  duration: number;
  /** Offset into the source media, in source seconds. */
  inPoint: number;
  speed: number;
  volume: number; // 0..2
  audioFadeIn: number;
  audioFadeOut: number;
  fit: 'contain' | 'cover';
  transform: Transform;
  filter: string;
  adjust: Adjust;
  animIn: AnimKind;
  animInDur: number;
  animOut: AnimKind;
  animOutDur: number;
  /** Transition from the previous clip on the same track into this one. */
  transition: TransitionKind;
  transitionDur: number;
  text?: TextStyle;
  caption?: Caption;
  sticker?: string;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  background: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  tracks: Track[];
  clips: Clip[];
}
