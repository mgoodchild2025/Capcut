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
  /** A working file (such as a depth map) kept out of the media library. */
  internal?: boolean;
  /** The media is stored under this other asset's id (drafts that share one game video). */
  blob?: string;
  /** Evenly spaced frames across the source, as data URLs. */
  filmstrip?: string[];
  /** Normalised peak values (0..1), WAVEFORM_RATE per second of source. */
  waveform?: number[];
  /** Beat times in source seconds, from the built-in library or beat detection. */
  beats?: number[];
  bpm?: number;
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

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'sticker' | 'graphic';

export type GraphicType = 'open' | 'stinger' | 'lowerThird' | 'scoreBug' | 'playerCard' | 'stats' | 'roster' | 'final' | 'closer' | 'replay' | 'telestrator' | 'versus' | 'victory' | 'potw' | 'badge' | 'commit';

/** A telestrator drawing: points are fractions of the frame. Circles are [centre, edge]; arrows and lines [from, to]. */
export interface TeleMark {
  kind: 'arrow' | 'circle' | 'line' | 'pen';
  pts: [number, number][];
  color: string;
}

/** A broadcast motion graphic, drawn procedurally each frame (see engine/graphics.ts). */
export interface GraphicSpec {
  type: GraphicType;
  /** Team colours: primary, accent. */
  colors: [string, string];
  /** The opponent's colours, for graphics that show both teams (the versus title). */
  oppColors?: [string, string];
  /** Named text fields (title, kicker, sub, name, number, position, ...), depending on the type. */
  text: Record<string, string>;
  /** Asset ids of the team's and the opponent's logos. */
  logo?: string;
  oppLogo?: string;
  /** Stat rows: [label, value]. */
  rows?: [string, string][];
  /** Roster wall tiles. */
  players?: { number: string; name: string; photo?: string }[];
  /** Set scores, [ours, theirs]. */
  sets?: [number, number][];
  /** The clip's photo has a transparent background: show the player cut out rather than in a window. */
  cutout?: boolean;
  /** What the clip's own asset is, so export knows to decode it as video. */
  media?: 'image' | 'video';
  /** Visual style of the package. */
  look?: GraphicLook;
  /** How the final board totals up: sets won, or points (goals, runs) summed over periods. */
  scoring?: 'sets' | 'points';
  /** Depth map (asset id) of the clip's photo, for the living-photo parallax. */
  depth?: string;
  /** Show the photo still even though it has a depth map. */
  still?: boolean;
  /** Telestrator drawings, drawn in order. */
  marks?: TeleMark[];
}

export type GraphicLook = 'broadcast' | 'championship' | 'neon' | 'classic';

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
  | 'blur'
  | 'flash';

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

/** A point on a speed curve: at fraction `p` (0..1) through the clip, play at `s` times the clip speed. */
export interface SpeedPoint {
  p: number;
  s: number;
}

export interface SpeedCurve {
  /** Preset the curve came from, for display. */
  id: string;
  points: SpeedPoint[];
}

export type KeyProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export interface Keyframe {
  /** Seconds from the clip's start on the timeline. */
  t: number;
  v: number;
  /** How to move from this keyframe to the next: eased (default) or at a steady rate (camera paths). */
  ease?: 'linear';
}

export interface Crop {
  /** Fractions of the source trimmed from each edge. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ChromaKey {
  color: string;
  /** 0..1, how far from the key colour still counts as background. */
  similarity: number;
  /** 0..1, width of the soft edge. */
  smoothness: number;
}

/** Freeze-frame callout on the player at the start of a clip, as in recruiting reels. */
export interface Spotlight {
  /** Centre of the ring as fractions of the source frame. */
  x: number;
  y: number;
  /** Ring radius as a fraction of the source frame height. */
  r: number;
  color: string;
  label: string;
  /** Zoom towards the player during the hold. */
  zoom: boolean;
}

/** A name marker that rides above a tracked player through the clip. */
export interface Follow {
  /** Where the player is over source time, as fractions of the source frame. */
  path: { t: number; x: number; y: number }[];
  color: string;
  label: string;
}

export interface Marker {
  id: string;
  t: number;
  label: string;
  color: string;
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
  /** Variable speed across the clip (CapCut "curve" speed). */
  curve?: SpeedCurve;
  /** Seconds the first frame is held before playback starts (used by Spotlight). */
  hold?: number;
  spotlight?: Spotlight;
  follow?: Follow;
  keyframes?: Partial<Record<KeyProp, Keyframe[]>>;
  crop?: Crop;
  flipH?: boolean;
  flipV?: boolean;
  chroma?: ChromaKey;
  /** Motion graphic (kind 'graphic'); its `assetId`, if any, is the photo or clip it shows. */
  graphic?: GraphicSpec;
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
  markers?: Marker[];
  /** A moment to show as the cover while the playhead waits at the start (a reel's finished title). */
  poster?: number;
}
