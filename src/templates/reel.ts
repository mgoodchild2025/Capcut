import type { Asset, GraphicLook, Project } from '../model/types';
import type { SportId } from './sports';
import { buildBroadcastReel } from './broadcast';
import { buildLeaguePromo, isLeagueStyle } from './league';

export type ReelStyle = 'recruiting' | 'hype' | 'recap' | 'spotlight' | 'potw' | 'team' | 'victory' | 'lineup' | 'matchup' | 'season' | 'gamenight' | 'playoffs' | 'signup' | 'schedule' | 'standings' | 'tournament' | 'final' | 'champions';

/** Which wizard steps a style uses and what it's about. */
export type ReelSubject = 'player' | 'team' | 'league';

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
  /** Introduces the opponent's starters too. */
  opponents?: boolean;
  /** League promos for a tournament (grouped apart from the league's). */
  tournament?: boolean;
}[] = [
  {
    id: 'recruiting',
    title: 'Recruiting reel',
    blurb: 'Clean 16:9 cut for college coaches: profile card, player spotlights, skill labels, stats and contact info.',
    aspect: [1920, 1080],
    music: 'determined-pursuit',
    subject: 'player',
    spotlight: true,
  },
  {
    id: 'hype',
    title: 'Hype reel',
    blurb: 'Vertical 9:16 for TikTok and Reels: beat-synced cuts, slow-mo on the hit, flashes and whooshes.',
    aspect: [1080, 1920],
    music: 'lucid-trigger',
    subject: 'player',
    spotlight: true,
  },
  {
    id: 'spotlight',
    title: 'Player spotlight',
    blurb: 'Square-ish 4:5 for the Instagram feed: Player of the Game, Senior Night or Athlete of the Week. Every play rings your player.',
    aspect: [1080, 1350],
    music: 'warped',
    subject: 'player',
    spotlight: true,
  },
  {
    id: 'potw',
    title: 'Play of the Week',
    blurb: 'One unforgettable play, broadcast style: an award title package, the play at full speed, then slow-motion replays from every angle with the analyst\'s pen.',
    aspect: [1080, 1920],
    music: 'determined-pursuit',
    subject: 'player',
    spotlight: true,
  },
  {
    id: 'team',
    title: 'Team reel',
    blurb: 'Vertical 9:16 for the team account: roster card, beat-synced plays credited to each player, team stats and a send-off.',
    aspect: [1080, 1920],
    music: 'hyper-ultra-racing',
    subject: 'team',
    roster: 'credits',
  },
  {
    id: 'victory',
    title: 'Victory reel',
    blurb: 'The post-game W in 9:16: the final score slams in under confetti, then beat-cut plays credited to each player, game stats and a celebration send-off.',
    aspect: [1080, 1920],
    music: 'fever-stadium',
    subject: 'team',
    roster: 'credits',
  },
  {
    id: 'lineup',
    title: 'Starting lineup',
    blurb: 'Pre-game hype in 9:16: each starter gets a beat-timed reveal with number, name and position over their photo or clip.',
    aspect: [1080, 1920],
    music: 'doomed',
    subject: 'team',
    roster: 'intros',
  },
  {
    id: 'matchup',
    title: 'Matchup lineup',
    blurb: 'Game day with both teams: a split-screen versus title, the visitors\' starters in their colours, then yours, and a face-off to start the game.',
    aspect: [1080, 1920],
    music: 'let-the-games-begin',
    subject: 'team',
    roster: 'intros',
    opponents: true,
  },
  {
    id: 'recap',
    title: 'Season recap',
    blurb: 'Team-focused 16:9 montage: season title, best rallies with smooth dissolves, team stats and a send-off.',
    aspect: [1920, 1080],
    music: 'great-mission',
    subject: 'team',
  },
  // League promos: broadcast-network spots for the whole league.
  {
    id: 'season',
    title: 'Season launch',
    blurb: 'The network-style season promo: cinematic cold open, slamming type, every team, opening night and the league sign-off.',
    aspect: [1920, 1080],
    music: 'the-rush',
    subject: 'league',
  },
  {
    id: 'gamenight',
    title: 'Game night',
    blurb: "Tonight's big matchup, promoted like prime time: team versus team, when and where to watch.",
    aspect: [1920, 1080],
    music: 'final-hour',
    subject: 'league',
  },
  {
    id: 'playoffs',
    title: 'Playoffs',
    blurb: 'Win or go home: the bracket draws in, the stakes in big type, and when it all begins.',
    aspect: [1920, 1080],
    music: 'determined-pursuit',
    subject: 'league',
  },
  {
    id: 'signup',
    title: 'Registration',
    blurb: 'Fill the league: an upbeat spot that ends on divisions, dates, fees and a QR code to sign up.',
    aspect: [1920, 1080],
    music: 'rhythm-factory',
    subject: 'league',
  },
  {
    id: 'schedule',
    title: 'This week',
    blurb: "The week's big games on one board: who plays whom, when and where.",
    aspect: [1920, 1080],
    music: 'let-the-games-begin',
    subject: 'league',
  },
  {
    id: 'standings',
    title: 'Standings',
    blurb: 'The race for first: the table builds in, the leader on top, every game counting.',
    aspect: [1920, 1080],
    music: 'black-diamond',
    subject: 'league',
  },
  {
    id: 'tournament',
    title: 'Tournament',
    blurb: 'Announce the event: when, where, the divisions and the prize, and a QR code to enter a team.',
    aspect: [1920, 1080],
    music: 'twists',
    subject: 'league',
    tournament: true,
  },
  {
    id: 'final',
    title: 'Championship final',
    blurb: 'Two teams, one trophy: the finalists face off, then when the final starts.',
    aspect: [1920, 1080],
    music: 'great-mission',
    subject: 'league',
    tournament: true,
  },
  {
    id: 'champions',
    title: 'Champions',
    blurb: 'Crown the winners: the champions with confetti, the podium, the MVP and the sign-off.',
    aspect: [1920, 1080],
    music: 'fever-stadium',
    subject: 'league',
    tournament: true,
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
  /** The opponent's roster (matchup lineup), colours and record. */
  oppRoster?: RosterPlayer[];
  oppColors?: [string, string];
  oppRecord?: string;
  /** When and where, e.g. "Fri 7 PM · Lincoln Gym" (matchup lineup). */
  venue?: string;
  /** The award ("Play of the Week") and its week ("Week 7"). */
  award?: string;
  week?: string;
  /** The team's name on posters, kept apart from the player's (`name`) so both can be filled in. */
  team?: string;
  /** A commitment announcement: the college and its logo (PNG data URL). */
  college?: string;
  collegeLogo?: string;
  /** League promos (the league is `name`, its logo `logo`, its colours `colors`). */
  league?: LeagueDetails;
  /** League promos are 16:9 for screens, or 9:16 for Stories and Reels. */
  format?: 'tv' | 'social';
}

/** A team in the league. */
export interface LeagueTeam {
  key: string;
  name: string;
  colors: [string, string];
  /** Logo as a PNG data URL. */
  logo?: string;
  record?: string;
  /** Standings points. */
  points?: string;
}

/** What a league promo says beyond the league's name, logo and colours. */
export interface LeagueDetails {
  /** The slogan, in short sentences: "Every point. Every night. One champion." */
  tagline: string;
  /** When: "Opening night · Sat Jan 10 · 7 PM". */
  when: string;
  /** Where to be or to watch: "Metro Arena · Live on YouTube". */
  where: string;
  url: string;
  /** "Presented by ..." */
  sponsor: string;
  teams: LeagueTeam[];
  /** Game night: the two teams, by key (home last, as broadcasts bill it). */
  home?: string;
  away?: string;
  /** Registration. */
  divisions?: string;
  deadline?: string;
  fee?: string;
  /** This week's games. */
  games?: LeagueGame[];
  /** A tournament's prize: "$2,000 prize pool", "Trophy and medals". */
  prize?: string;
  /** Champions: the final's score and the tournament's MVP. */
  score?: string;
  mvp?: string;
}

/** A game on the schedule: two teams by key, when and where. */
export interface LeagueGame {
  key: string;
  away: string;
  home: string;
  when: string;
  where: string;
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
  /** Crowd cheer under the final score and send-off. */
  crowd?: string;
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
  /** League promos: each team's logo, by team key. */
  teamLogos?: Record<string, string>;
}

export interface ReelInput {
  style: ReelStyle;
  info: ReelInfo;
  clips: ReelClip[];
  cards: ReelAssets;
}

/** Lays out a whole highlight reel on a fresh timeline. */
export function buildReel(input: ReelInput, assets: Record<string, Asset>): Project {
  return isLeagueStyle(input.style) ? buildLeaguePromo(input, assets) : buildBroadcastReel(input, assets);
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
