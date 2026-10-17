import type { Asset, GraphicLook, Project } from '../model/types';
import type { SportId } from './sports';
import { buildBroadcastReel } from './broadcast';

export type ReelStyle = 'recruiting' | 'hype' | 'recap' | 'spotlight' | 'team' | 'lineup';

/** Which wizard steps a style uses and what it's about. */
export type ReelSubject = 'player' | 'team';

export const REEL_STYLES: {
  id: ReelStyle;
  title: string;
  blurb: string;
  aspect: [number, number];
  music: string;
  subject: ReelSubject;
  /** Credits each play to someone on the roster, or introduces the roster (no game clips). */
  roster?: 'credits' | 'intros';
  /** Asks the user to spot their player in each clip. */
  spotlight?: boolean;
}[] = [
  {
    id: 'recruiting',
    title: 'Recruiting reel',
    blurb: 'Clean 16:9 cut for college coaches: profile card, player spotlights, skill labels, stats and contact info.',
    aspect: [1920, 1080],
    music: 'showcase',
    subject: 'player',
    spotlight: true,
  },
  {
    id: 'hype',
    title: 'Hype reel',
    blurb: 'Vertical 9:16 for TikTok and Reels: beat-synced cuts, slow-mo on the hit, flashes and whooshes.',
    aspect: [1080, 1920],
    music: 'spike-anthem',
    subject: 'player',
    spotlight: true,
  },
  {
    id: 'spotlight',
    title: 'Player spotlight',
    blurb: 'Square-ish 4:5 for the Instagram feed: Player of the Game, Senior Night or Athlete of the Week. Every play rings your player.',
    aspect: [1080, 1350],
    music: 'game-day',
    subject: 'player',
    spotlight: true,
  },
  {
    id: 'team',
    title: 'Team reel',
    blurb: 'Vertical 9:16 for the team account: roster card, beat-synced plays credited to each player, team stats and a send-off.',
    aspect: [1080, 1920],
    music: 'spike-anthem',
    subject: 'team',
    roster: 'credits',
  },
  {
    id: 'lineup',
    title: 'Starting lineup',
    blurb: 'Pre-game hype in 9:16: each starter gets a beat-timed reveal with number, name and position over their photo or clip.',
    aspect: [1080, 1920],
    music: 'spike-anthem',
    subject: 'team',
    roster: 'intros',
  },
  {
    id: 'recap',
    title: 'Season recap',
    blurb: 'Team-focused 16:9 montage: season title, best rallies with smooth dissolves, team stats and a send-off.',
    aspect: [1920, 1080],
    music: 'victory-lap',
    subject: 'team',
  },
];


export interface RosterPlayer {
  key: string;
  number: string;
  name: string;
  position: string;
  /** In the starting lineup. */
  starter: boolean;
  /** Photo or clip for their lineup reveal (not remembered between projects). */
  assetId?: string;
  /** Cut them out of the photo's background. */
  cutout?: boolean;
}

export interface ReelInfo {
  /** Player name, or team name for team reels. */
  name: string;
  number: string;
  position: string;
  gradYear: string;
  height: string;
  club: string;
  school: string;
  email: string;
  phone: string;
  season: string;
  record: string;
  colors: [string, string];
  stats: [string, string][];
  /** Spotlight title, e.g. "Player of the Game". */
  headline: string;
  /** Opponent: the starting lineup's "vs", and the score bug. */
  opponent: string;
  roster: RosterPlayer[];
  /** Set scores as typed, [ours, theirs]. */
  sets: [string, string][];
  /** Team logo as a PNG data URL (remembered between projects). */
  logo?: string;
  /** Opponent's logo as a PNG data URL. */
  oppLogo?: string;
  sport?: SportId;
  /** Graphics package style. */
  look?: GraphicLook;
  /** Bring still photos to life with depth parallax (default on). */
  livePhotos?: boolean;
  /** Featured player's photo or clip for this project, and whether to cut them out of the background. */
  photo?: string;
  photoCutout?: boolean;
  /** Heading of the stats board, when the default ("Season stats"...) doesn't fit. */
  statsTitle?: string;
}

export interface ReelClip {
  assetId: string;
  inPoint: number;
  duration: number;
  tag?: string;
  /** Player position in the frame (fractions), for the spotlight and vertical reframing. */
  spotlight?: { x: number; y: number };
  /** Roster key of the player who made the play (team reels). */
  player?: string;
  /** Score after the rally, e.g. "18-21", and which set. */
  score?: string;
  set?: number;
  /** Where the action is over time (source seconds, 0..1 across the frame), from auto-follow. */
  track?: { t: number; x: number }[];
  /** The spotted player's position over source time, from following them through the play. */
  path?: { t: number; x: number; y: number }[];
  /** Follow the play with a slow-motion instant replay. */
  replay?: boolean;
}

export interface ReelAssets {
  music?: string;
  whoosh?: string;
  impact?: string;
  /** Photos or clips by roster key. */
  players?: Record<string, string>;
  logo?: string;
  oppLogo?: string;
  /** The featured player's photo or clip (player reels). */
  photo?: string;
  /** Photos with transparent backgrounds, shown as cut-outs. */
  cutouts?: string[];
  /** Depth maps (asset ids) by photo asset id, for living photos. */
  depths?: Record<string, string>;
}

export interface ReelInput {
  style: ReelStyle;
  info: ReelInfo;
  clips: ReelClip[];
  cards: ReelAssets;
}

/** Lays out a whole highlight reel on a fresh timeline. */
export function buildReel(input: ReelInput, assets: Record<string, Asset>): Project {
  return buildBroadcastReel(input, assets);
}

/** Popular team colour pairs. */
export const TEAM_COLORS: { label: string; colors: [string, string] }[] = [
  { label: 'Royal & gold', colors: ['#1d4ed8', '#fbbf24'] },
  { label: 'Crimson & white', colors: ['#b91c1c', '#f8fafc'] },
  { label: 'Navy & teal', colors: ['#1e3a8a', '#14b8a6'] },
  { label: 'Black & orange', colors: ['#18181b', '#f97316'] },
  { label: 'Purple & gold', colors: ['#6d28d9', '#facc15'] },
  { label: 'Green & white', colors: ['#15803d', '#f0fdf4'] },
  { label: 'Maroon & silver', colors: ['#7f1d1d', '#cbd5e1'] },
  { label: 'Pink & black', colors: ['#db2777', '#111827'] },
];
