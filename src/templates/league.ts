/**
 * League promos in the style of a sports network's spots: a cinematic cold open, the slogan
 * slamming in over fast cuts, the league's teams, when it happens, and the league's sign-off,
 * all cut to the bars of the music.
 */
import { createGraphicClip, createMediaClip, createProject } from '../model/factory';
import { appendToMain, clipEnd, placeClip } from '../model/ops';
import { CURVE_PRESETS, durationForSpan } from '../model/timing';
import type { Asset, Clip, GraphicSpec, GraphicType, Project } from '../model/types';
import { uid } from '../utils';
import type { LeagueDetails, LeagueTeam, ReelClip, ReelInput, ReelStyle } from './reel';
import { REEL_STYLES } from './reel';
import { upper } from './shared';

type LeagueStyle = Extract<ReelStyle, 'season' | 'gamenight' | 'playoffs' | 'signup'>;
export const LEAGUE_STYLES: LeagueStyle[] = ['season', 'gamenight', 'playoffs', 'signup'];
export const isLeagueStyle = (s: ReelStyle): s is LeagueStyle => (LEAGUE_STYLES as ReelStyle[]).includes(s);

/** Each spot's slogan, when the league hasn't written one. */
export const DEFAULT_TAGLINE: Record<LeagueStyle, string> = {
  season: 'Every point. Every night. One champion.',
  gamenight: 'One night. One winner.',
  playoffs: 'Win or go home.',
  signup: 'Your league. Your team. Your season.',
};

/** The cold open's words. */
const COLD_OPEN: Record<LeagueStyle, string[]> = {
  season: ['The wait', 'is over'],
  gamenight: ['Tonight'],
  playoffs: ['It all', 'comes down', 'to this'],
  signup: ['New season', 'starts now'],
};

export const blankLeague = (): LeagueDetails => ({ tagline: '', when: '', where: '', url: '', sponsor: '', teams: [] });

/** A slogan in punches: its sentences ("Every point." "Every night."). */
export function punches(tagline: string): string[] {
  return tagline
    .split(/(?<=[.!?])\s+|\s+·\s+|\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

/** "Sat Jan 10 · 7 PM · Metro Arena": the first part is the headline, the rest its line. */
export function whenParts(when: string): { title: string; sub: string } {
  const parts = when
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  return { title: parts[0] ?? '', sub: parts.slice(1).join('  ·  ') };
}

export function buildLeaguePromo(input: ReelInput, assets: Record<string, Asset>): Project {
  const style = input.style as LeagueStyle;
  const meta = REEL_STYLES.find((s) => s.id === style)!;
  const { info, cards } = input;
  const L: LeagueDetails = { ...blankLeague(), ...info.league };
  const [W, H] = info.format === 'social' ? [1080, 1920] : [1920, 1080];
  const league = info.name.trim() || 'Our League';
  const music = cards.music ? assets[cards.music] : undefined;
  const beat = music?.bpm ? 60 / music.bpm : 0.5;
  const bar = beat * 4;
  /** About `n` bars, in whole beats (a promo hits every cut on the music). */
  const bars = (n: number) => Math.max(beat, Math.round((n * bar) / beat) * beat);
  const has = (id?: string) => !!id && !!assets[id];
  const logo = has(cards.logo) ? cards.logo : undefined;
  const teamOf = (t: LeagueTeam) => ({ name: t.name.trim() || 'Team', colors: t.colors, logo: has(cards.teamLogos?.[t.key]) ? cards.teamLogos![t.key] : undefined });
  const teams = L.teams.filter((t) => t.name.trim()).map(teamOf);
  const spec = (type: GraphicType, text: Record<string, string>, extra: Partial<GraphicSpec> = {}): GraphicSpec => ({
    type,
    colors: info.colors,
    text,
    logo,
    look: info.look,
    ...extra,
  });

  let p: Project = { ...createProject(W, H, `${league} ${meta.title}`), markers: [] };
  const overlays: Clip[] = [];
  const cuts: number[] = [];
  const end = () => (p.clips.length ? clipEnd(p.clips[p.clips.length - 1]) : 0);
  const full = (type: GraphicType, text: Record<string, string>, duration: number, extra: Partial<GraphicSpec> = {}, label = '') => {
    cuts.push(end());
    p = appendToMain(p, createGraphicClip(spec(type, text, extra), 0, duration, label));
  };
  const over = (type: GraphicType, text: Record<string, string>, start: number, duration: number, label = '') =>
    overlays.push(createGraphicClip(spec(type, text), start, duration, label));

  // The footage, taken in turn (round again if there's less than the spot needs).
  const footage = input.clips.filter((rc) => has(rc.assetId));
  let next = 0;
  const take = (): ReelClip | undefined => (footage.length ? footage[next++ % footage.length] : undefined);
  /** A play filling `dur` seconds: optionally slowed in the middle, and punching in as it lands. */
  const play = (rc: ReelClip, dur: number, o: { slow?: boolean; punch?: boolean; transition?: Clip['transition'] } = {}) => {
    const a = assets[rc.assetId];
    const available = a.kind === 'image' ? Infinity : Math.max(0.3, a.duration - rc.inPoint);
    let c: Clip = {
      ...createMediaClip(a),
      inPoint: a.kind === 'image' ? 0 : rc.inPoint,
      volume: 0.1,
      fit: 'cover',
      transition: o.transition ?? 'none',
      transitionDur: Math.min(0.25, beat),
    };
    if (o.slow && a.kind === 'video') {
      const hero = CURVE_PRESETS.find((x) => x.id === 'hero')!;
      c.curve = { id: 'hero', points: hero.points.map((x) => ({ ...x })) };
    }
    c.duration = a.kind === 'image' ? dur : Math.min(dur, durationForSpan({ ...c, duration: dur }, available));
    if (o.punch)
      c.keyframes = {
        scale: [
          { t: 0, v: 1.14 },
          { t: Math.min(0.45, c.duration / 2), v: 1 },
        ],
      };
    cuts.push(end());
    p = appendToMain(p, c);
    return c;
  };

  // ---------- cold open: slow motion behind cinema bars, the first words landing ----------
  const coldWords = COLD_OPEN[style];
  const cold = [take(), footage.length > 1 ? take() : undefined].filter((x): x is ReelClip => !!x);
  if (cold.length) {
    cold.forEach((rc) => play(rc, bars(cold.length > 1 ? 1.5 : 2.5), { slow: true }));
    const coldEnd = end();
    over('letterbox', { caption: [league, info.season].filter(Boolean).join('  ·  ') }, 0, coldEnd, 'Letterbox');
    over('kinetic', { lines: coldWords.join('|'), mode: 'slam' }, Math.min(0.8, coldEnd * 0.25), coldEnd - Math.min(0.8, coldEnd * 0.25) + 0.05, coldWords.join(' '));
  } else full('kinetic', { lines: coldWords.join('|'), mode: 'slam', bg: '1' }, bars(2), {}, coldWords.join(' '));

  // ---------- the spot's centrepiece ----------
  let poster: number | null = null;
  if (style === 'season' && teams.length) {
    const title = teams.length > 1 ? `${teams.length} teams. One crown.` : league;
    full('logoWall', { title: upper(title) }, bars(teams.length > 8 ? 3 : 2.5), { teams }, 'Teams');
    // The cover: every team on the wall, the league's logo landed.
    poster = end() - 0.3;
  }
  if (style === 'gamenight') {
    const away = L.teams.find((t) => t.key === L.away) ?? L.teams[0];
    const home = L.teams.find((t) => t.key === L.home && t !== away) ?? L.teams.find((t) => t !== away);
    const a = away ? teamOf(away) : { name: 'Away', colors: info.colors, logo: undefined };
    const h = home ? teamOf(home) : { name: 'Home', colors: ['#b91c1c', '#f8fafc'] as [string, string], logo: undefined };
    poster = end() + 2.4;
    full(
      'versus',
      {
        kicker: 'GAME NIGHT',
        usName: upper(a.name),
        themName: upper(h.name),
        usSub: away?.record ?? '',
        themSub: home?.record ?? '',
        sub: [whenParts(L.when).title, L.where].filter(Boolean).join('  ·  '),
      },
      bars(2.5),
      { colors: a.colors, logo: a.logo, oppColors: h.colors, oppLogo: h.logo },
      `${a.name} at ${h.name}`,
    );
  }
  if (style === 'playoffs') {
    poster = end() + 2.8;
    full('bracket', { title: upper([info.season, 'Playoffs'].filter(Boolean).join(' ')), final: 'CHAMPION' }, bars(3), { teams }, 'Bracket');
  }

  // ---------- the slogan, a punch at a time over the fastest cuts ----------
  const lines = punches(L.tagline.trim() || DEFAULT_TAGLINE[style]);
  lines.forEach((line, i) => {
    const rc = take();
    const from = end();
    if (rc) {
      // Two quick cuts a bar when there's footage to spare.
      if (footage.length > lines.length + cold.length) {
        play(rc, bars(0.5), { punch: true, transition: i ? 'flash' : 'none' });
        play(take()!, bars(0.5), { punch: true });
      } else play(rc, bars(1), { punch: true, transition: i ? 'flash' : 'none' });
      over('kinetic', { lines: line, mode: 'slam', dim: '1' }, from + 0.04, end() - from - 0.04, line);
    } else full('kinetic', { lines: line, mode: 'slam', bg: '1' }, bars(1), {}, line);
    over('glitch', {}, Math.max(0, from - 0.12), 0.3, '');
  });

  // ---------- montage: what's left, fast ----------
  // Footage not yet seen (up to six plays).
  const montage = Math.min(6, Math.max(0, footage.length - next));
  for (let i = 0; i < montage; i++) {
    const from = end();
    play(take()!, bars(0.5), { punch: i % 2 === 0, transition: i % 3 === 2 ? 'zoom' : 'none' });
    if (i % 2 === 1) over('glitch', {}, Math.max(0, from - 0.12), 0.3, '');
  }

  // ---------- the details ----------
  if (style === 'signup') {
    const rows: [string, string][] = [
      ['Divisions', L.divisions ?? ''],
      ['Season', L.when],
      ['Fee', L.fee ?? ''],
      ['Register by', L.deadline ?? ''],
    ].filter(([, v]) => v.trim()) as [string, string][];
    poster = end() + 2.2;
    full('signup', { title: 'REGISTRATION OPEN', url: L.url.trim() }, bars(3.5), { rows }, 'Sign up');
  } else if (L.when.trim()) {
    const { title, sub } = whenParts(L.when);
    const kicker = style === 'season' ? 'Season tips off' : style === 'playoffs' ? 'Playoffs begin' : 'Game night';
    full('dateSlate', { kicker: upper(kicker), title: upper(title), sub, where: L.where }, bars(2), {}, title);
  }

  // ---------- sign-off ----------
  const signOff = end();
  full('endSlate', { title: upper(league), tagline: L.tagline.trim() || DEFAULT_TAGLINE[style], url: L.url.trim(), sponsor: L.sponsor.trim() }, bars(2.5), {}, league);
  const total = end();
  p.poster = +(poster ?? signOff + 2).toFixed(2);

  // ---------- overlays and sound ----------
  for (const o of overlays) p = placeClip(p, o);
  const lead = music?.beats?.length && music.bpm ? music.beats[0] % beat : 0;
  if (music) {
    const m = createMediaClip(music);
    m.inPoint = lead;
    m.duration = Math.min(m.duration - lead, total);
    m.volume = 0.95;
    m.audioFadeOut = Math.min(2, m.duration / 4);
    p = placeClip(p, m);
  }
  const whoosh = cards.whoosh ? assets[cards.whoosh] : undefined;
  if (whoosh)
    for (const t of new Set(cuts.filter((t) => t > 0.5).map((t) => +t.toFixed(3))))
      p = placeClip(p, { ...createMediaClip(whoosh), start: Math.max(0, t - 0.35), volume: 0.45, id: uid('c_') });
  const impact = cards.impact ? assets[cards.impact] : undefined;
  if (impact)
    for (const t of [p.clips.find((c) => c.graphic && ['logoWall', 'versus', 'bracket'].includes(c.graphic.type))?.start, signOff].filter((x): x is number => x !== undefined))
      p = placeClip(p, { ...createMediaClip(impact), start: t + 0.25, volume: 0.7, id: uid('c_') });
  const crowd = cards.crowd ? assets[cards.crowd] : undefined;
  if (crowd) {
    const c = { ...createMediaClip(crowd), start: Math.max(0, signOff - 0.3), volume: 0.3, id: uid('c_') };
    c.duration = Math.min(crowd.duration, total - c.start);
    c.audioFadeIn = 0.4;
    c.audioFadeOut = Math.min(1.5, c.duration / 3);
    p = placeClip(p, c);
  }
  if (music?.beats && music.bpm) {
    const onTimeline = music.beats.map((b) => b - lead).filter((t) => t >= -0.01);
    p = { ...p, markers: onTimeline.filter((t, i) => i % 4 === 0 && t < total).map((t) => ({ id: uid('m_'), t: Math.max(0, t), label: 'beat', color: '#00c2d1' })) };
  }
  return p;
}
