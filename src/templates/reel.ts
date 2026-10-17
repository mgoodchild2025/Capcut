import { contrastInk } from '../engine/render';
import { createMediaClip, createProject } from '../model/factory';
import { appendToMain, clipEnd, getMainTrack, placeClip } from '../model/ops';
import { CURVE_PRESETS, durationForSpan } from '../model/timing';
import type { Asset, Clip, Project, TransitionKind } from '../model/types';
import { uid } from '../utils';
import { barFitter, IMPACT, SANS, text, upper } from './shared';
import { buildLineupReel, buildSpotlightReel, buildTeamReel } from './teamReels';

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

export const POSITIONS = ['Outside Hitter', 'Opposite', 'Middle Blocker', 'Setter', 'Libero', 'Defensive Specialist', 'Right Side'];
export const SKILL_TAGS = ['Kill', 'Ace', 'Block', 'Dig', 'Set', 'Serve receive', 'Save'];

export interface RosterPlayer {
  key: string;
  number: string;
  name: string;
  position: string;
  /** In the starting lineup. */
  starter: boolean;
  /** Photo or clip for their lineup reveal (not remembered between projects). */
  assetId?: string;
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
  /** Tonight's opponent, for the starting lineup. */
  opponent: string;
  roster: RosterPlayer[];
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
}

export interface ReelAssets {
  intro: string;
  info?: string;
  stats?: string;
  outro: string;
  music?: string;
  whoosh?: string;
  impact?: string;
  /** Roster card background (team reels). */
  roster?: string;
  /** Jersey-number cards by roster key, for players without a photo or clip. */
  players?: Record<string, string>;
}

export interface ReelInput {
  style: ReelStyle;
  info: ReelInfo;
  clips: ReelClip[];
  cards: ReelAssets;
}

/** Lays out a whole highlight reel on a fresh timeline. */
export function buildReel(input: ReelInput, assets: Record<string, Asset>): Project {
  if (input.style === 'spotlight') return buildSpotlightReel(input, assets);
  if (input.style === 'team') return buildTeamReel(input, assets);
  if (input.style === 'lineup') return buildLineupReel(input, assets);
  const style = REEL_STYLES.find((s) => s.id === input.style)!;
  const [W, H] = style.aspect;
  const portrait = H > W;
  const { info, cards } = input;
  const c2 = info.colors[1];
  const name = info.name.trim() || (input.style === 'recap' ? 'Our Season' : 'Player Name');
  const music = cards.music ? assets[cards.music] : undefined;
  const beat = music?.bpm ? 60 / music.bpm : 0;
  const bar = beat * 4;
  const hype = input.style === 'hype';
  const recap = input.style === 'recap';

  /** Hype reels snap every section to whole bars of the music. */
  const fit = barFitter(bar, hype);

  let p: Project = { ...createProject(W, H, recap ? `${name} Season Recap` : `${name} Highlights`), markers: [] };
  const overlays: Clip[] = [];
  const card = (assetId: string, duration: number): Clip => {
    const a = assets[assetId];
    return { ...createMediaClip(a), duration, fit: 'cover' };
  };
  const nameSize = Math.min(portrait ? 150 : 170, Math.round((portrait ? 900 : 1100) / Math.max(6, name.length) * 1.6));

  // ---------- intro ----------
  const introDur = fit(hype ? 2.6 : 3.6);
  p = appendToMain(p, card(cards.intro, introDur));
  const ix = portrait ? 0 : -0.2;
  const iy = portrait ? -0.12 : 0;
  const kicker = recap ? upper(info.season ? `Season ${info.season}` : 'Season recap') : info.number ? `#${info.number.replace('#', '')}` : '';
  if (kicker) overlays.push(text(kicker, 0.15, introDur - 0.15, { fontFamily: IMPACT, fontSize: 70, color: c2, bold: true }, ix, iy - (portrait ? 0.075 : 0.15), { animIn: 'fade', animInDur: 0.4 }));
  overlays.push(text(upper(name), 0.25, introDur - 0.25, { fontFamily: IMPACT, fontSize: nameSize, bold: true, color: '#ffffff', strokeWidth: 0 }, ix, iy, { animIn: hype ? 'pop' : 'slide-up', animInDur: 0.5 }));
  const sub = recap
    ? [info.record && `Record ${info.record}`, info.club].filter(Boolean).join('  ·  ')
    : [info.position, info.gradYear && `Class of ${info.gradYear}`].filter(Boolean).join('  ·  ');
  if (sub) overlays.push(text(upper(sub), 0.55, introDur - 0.55, { fontFamily: SANS, fontSize: 46, color: '#e5e7eb' }, ix, iy + (portrait ? 0.07 : 0.14), { animIn: 'fade', animInDur: 0.5 }));
  const sub2 = recap ? info.school : [info.club, info.school].filter(Boolean).join('  |  ');
  if (sub2) overlays.push(text(sub2, 0.75, introDur - 0.75, { fontFamily: SANS, fontSize: 36, color: '#cbd5e1', bold: false }, ix, iy + (portrait ? 0.12 : 0.23), { animIn: 'fade', animInDur: 0.5 }));

  // ---------- profile card (recruiting) ----------
  if (input.style === 'recruiting' && cards.info) {
    const rows: [string, string][] = [
      ['Position', info.position],
      ['Height', info.height],
      ['Grad year', info.gradYear],
      ['Club', info.club],
      ['School', info.school],
    ].filter(([, v]) => v && v.trim()) as [string, string][];
    if (rows.length) {
      const start = clipEnd(p.clips[p.clips.length - 1]);
      const d = 4.2;
      const c = card(cards.info, d);
      c.transition = 'dissolve';
      c.transitionDur = 0.4;
      p = appendToMain(p, c);
      overlays.push(text('PLAYER PROFILE', start + 0.2, d - 0.2, { fontFamily: IMPACT, fontSize: 64, color: c2, bold: true }, -0.26, -0.3, { animIn: 'slide-right', animInDur: 0.45 }));
      const pad = Math.max(...rows.map(([k]) => k.length)) + 3;
      overlays.push(
        text(rows.map(([k, v]) => `${k.toUpperCase().padEnd(pad, ' ')}${v}`).join('\n'), start + 0.45, d - 0.45, { fontFamily: '"Courier New", monospace', fontSize: rows.length <= 3 ? 60 : 50, color: '#ffffff', align: 'left', bold: true }, -0.18, 0.05, { animIn: 'fade', animInDur: 0.5 }),
      );
    }
  }

  // ---------- highlights ----------
  const transitions: TransitionKind[] = hype ? ['flash', 'zoom', 'slide-left', 'blur'] : ['dissolve'];
  const firstClipStart = clipEnd(p.clips[p.clips.length - 1]);
  input.clips.forEach((rc, i) => {
    const a = assets[rc.assetId];
    if (!a) return;
    const base = createMediaClip(a);
    const available = a.kind === 'image' ? Infinity : Math.max(0.3, a.duration - rc.inPoint);
    let clip: Clip = { ...base, inPoint: a.kind === 'image' ? 0 : rc.inPoint, duration: Math.min(rc.duration, available), volume: hype ? 0.15 : recap ? 0.35 : 0.5 };
    if (hype && clip.duration >= 2.5 && a.kind === 'video') {
      const hero = CURVE_PRESETS.find((c) => c.id === 'hero')!;
      clip.curve = { id: 'hero', points: hero.points.map((x) => ({ ...x })) };
      clip.duration = Math.min(durationForSpan(clip, clip.duration), durationForSpan(clip, available));
    }
    const hold = rc.spotlight && !recap && a.kind === 'video' ? (hype ? 1 : 1.5) : 0;
    clip.duration = fit(clip.duration + hold, hold + (a.kind === 'image' ? Infinity : durationForSpan(clip, available)));
    if (hold) {
      clip.hold = hold;
      clip.spotlight = { x: rc.spotlight!.x, y: rc.spotlight!.y, r: 0.11, color: c2, label: info.number ? `#${info.number.replace('#', '')}` : upper(name.split(' ')[0]), zoom: true };
    }
    if (portrait && a.kind !== 'audio' && a.width > a.height) {
      // Vertical reel from landscape footage: fill the frame and keep the player centred.
      clip.fit = 'cover';
      const frameW = (a.width / a.height) * (H / W);
      const slack = (frameW - 1) / 2;
      const px = rc.spotlight?.x ?? 0.5;
      clip.transform = { ...clip.transform, x: Math.max(-slack, Math.min(slack, (0.5 - px) * frameW)) };
    }
    clip.transition = transitions[i % transitions.length];
    clip.transitionDur = hype ? Math.min(0.3, beat || 0.3) : recap ? 0.5 : 0.3;
    const start = clipEnd(p.clips[p.clips.length - 1]);
    p = appendToMain(p, clip);
    clip = p.clips[p.clips.length - 1];

    if (rc.tag) {
      const tagStart = start + hold + 0.2;
      overlays.push(
        text(upper(rc.tag), tagStart, Math.min(2, clip.duration - hold - 0.2), { fontFamily: IMPACT, fontSize: hype ? 96 : 60, color: contrastInk(c2), background: c2, bold: true, shadow: false }, portrait ? 0 : -0.36, portrait ? 0.3 : 0.37, { animIn: hype ? 'pop' : 'slide-right', animInDur: 0.3, animOut: 'fade', animOutDur: 0.25 }),
      );
    }
  });
  const clipsEnd = clipEnd(p.clips[p.clips.length - 1]);

  // Player tag in the corner across all highlights (recruiting).
  if (input.style === 'recruiting' && clipsEnd > firstClipStart) {
    const label = `${info.number ? `#${info.number.replace('#', '')} ` : ''}${upper(name)}${info.gradYear ? `  '${info.gradYear.slice(-2)}` : ''}`;
    overlays.push(text(label, firstClipStart, clipsEnd - firstClipStart, { fontFamily: SANS, fontSize: 34, color: '#ffffff', background: 'rgba(0,0,0,0.5)', shadow: false }, -0.37, -0.42));
  }

  // ---------- stats ----------
  const stats = info.stats.filter(([k, v]) => k.trim() && v.trim());
  if (stats.length && cards.stats) {
    const start = clipsEnd;
    const d = fit(4);
    const c = card(cards.stats, d);
    c.transition = hype ? 'flash' : 'dissolve';
    c.transitionDur = 0.35;
    p = appendToMain(p, c);
    const sx = portrait ? 0 : 0.18;
    overlays.push(text(recap ? 'TEAM STATS' : 'SEASON STATS', start + 0.2, d - 0.2, { fontFamily: IMPACT, fontSize: 70, color: c2, bold: true }, sx, portrait ? -0.18 : -0.3, { animIn: 'slide-down', animInDur: 0.45 }));
    const width = Math.max(...stats.map(([, v]) => v.length));
    overlays.push(
      text(stats.map(([k, v]) => `${v.padStart(width, ' ')}  ${k.toUpperCase()}`).join('\n'), start + 0.5, d - 0.5, { fontFamily: '"Courier New", monospace', fontSize: (portrait ? 70 : 62) + (stats.length <= 3 ? 16 : 0), color: '#ffffff', align: 'left', bold: true }, sx, portrait ? 0.02 : 0.06, { animIn: 'fade', animInDur: 0.5 }),
    );
  }

  // ---------- outro ----------
  {
    const start = clipEnd(p.clips[p.clips.length - 1]);
    const d = fit(recap ? 3.5 : 4.5);
    const c = card(cards.outro, d);
    c.transition = hype ? 'flash' : 'dissolve';
    c.transitionDur = 0.4;
    p = appendToMain(p, c);
    overlays.push(text(recap ? `GO ${upper(name)}!` : upper(name), start + 0.2, d - 0.2, { fontFamily: IMPACT, fontSize: recap ? 120 : 110, color: '#ffffff', bold: true }, 0, portrait ? -0.12 : -0.18, { animIn: 'pop', animInDur: 0.45 }));
    const contact = recap ? [info.season && `Season ${info.season}`, info.record].filter(Boolean) : [info.email, info.phone, [info.club, info.school].filter(Boolean).join(' · ')].filter(Boolean);
    if (contact.length) overlays.push(text(contact.join('\n'), start + 0.5, d - 0.5, { fontFamily: SANS, fontSize: 44, color: '#e5e7eb' }, 0, portrait ? 0.02 : 0.04, { animIn: 'fade', animInDur: 0.5 }));
    overlays.push(text('THANKS FOR WATCHING', start + 0.8, d - 0.8, { fontFamily: SANS, fontSize: 30, color: c2, shadow: false }, 0, portrait ? 0.16 : 0.3, { animIn: 'fade', animInDur: 0.5 }));
  }
  const total = clipEnd(p.clips[p.clips.length - 1]);

  // Text overlays all share the text tracks.
  for (const o of overlays) p = placeClip(p, o);

  // ---------- sound ----------
  if (music) {
    const m = createMediaClip(music);
    m.start = 0;
    m.duration = Math.min(m.duration, total);
    m.volume = hype ? 0.9 : recap ? 0.75 : 0.4;
    m.audioFadeOut = Math.min(2.5, m.duration / 4);
    p = placeClip(p, m);
  }
  if (hype && cards.whoosh) {
    const main = getMainTrack(p);
    const cuts = p.clips.filter((c) => c.trackId === main.id && c.start > 0.5).map((c) => c.start);
    for (const t of cuts) p = placeClip(p, { ...createMediaClip(assets[cards.whoosh]), start: Math.max(0, t - 0.35), volume: 0.55, id: uid('c_') });
  }
  if (cards.impact) p = placeClip(p, { ...createMediaClip(assets[cards.impact]), start: 0.25, volume: hype ? 0.8 : 0.45 });

  // Beat markers make it easy to keep editing in time with the music.
  if (music?.beats && bar) p = { ...p, markers: music.beats.filter((_, i) => i % 4 === 0 && _ < total).map((t) => ({ id: uid('m_'), t, label: 'beat', color: '#00c2d1' })) };
  return p;
}
