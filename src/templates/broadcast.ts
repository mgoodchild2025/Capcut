/**
 * Broadcast-style reels: every title, card and board is a motion graphic (engine/graphics.ts),
 * choreographed around the game footage like a TV sports package.
 */
import { followKeyframes } from '../ai/reframeCore';
import { createGraphicClip, createMediaClip, createProject, GRAPHIC_NAMES } from '../model/factory';
import { addTrack, appendToMain, clipEnd, getMainTrack, placeClip } from '../model/ops';
import { CURVE_PRESETS, durationForSpan, transformAt } from '../model/timing';
import type { Asset, Clip, GraphicSpec, GraphicType, Project, TeleMark, TransitionKind } from '../model/types';
import { followAt } from '../ai/trackCore';
import { uid } from '../utils';
import { playedSets, sides } from './match';
import { finalTotals, sportOf } from './sports';
import type { ReelClip, ReelInfo, ReelInput, ReelStyle, RosterPlayer } from './reel';
import { REEL_STYLES, TEAM_COLORS } from './reel';
import { barFitter, upper } from './shared';

/** How each style is cut. */
const LOOK: Record<ReelStyle, { beat: boolean; slowMo: boolean; transitions: TransitionKind[]; stingerEvery: number; volume: number; musicVolume: number; hold: number }> = {
  recruiting: { beat: false, slowMo: false, transitions: ['dissolve'], stingerEvery: 0, volume: 0.5, musicVolume: 0.45, hold: 1.5 },
  hype: { beat: true, slowMo: true, transitions: ['flash', 'zoom', 'slide-left', 'blur'], stingerEvery: 3, volume: 0.15, musicVolume: 0.9, hold: 1 },
  spotlight: { beat: false, slowMo: false, transitions: ['zoom', 'dissolve', 'slide-left', 'dissolve'], stingerEvery: 0, volume: 0.4, musicVolume: 0.7, hold: 1.2 },
  team: { beat: true, slowMo: true, transitions: ['flash', 'zoom', 'slide-left', 'blur'], stingerEvery: 3, volume: 0.15, musicVolume: 0.9, hold: 0 },
  lineup: { beat: true, slowMo: false, transitions: ['none'], stingerEvery: 0, volume: 0, musicVolume: 0.95, hold: 0 },
  matchup: { beat: true, slowMo: false, transitions: ['none'], stingerEvery: 0, volume: 0, musicVolume: 0.95, hold: 0 },
  victory: { beat: true, slowMo: true, transitions: ['flash', 'zoom', 'slide-left', 'blur'], stingerEvery: 3, volume: 0.15, musicVolume: 0.9, hold: 0 },
  // The play at full speed with the crowd, then the replays carry it.
  potw: { beat: false, slowMo: false, transitions: ['none'], stingerEvery: 0, volume: 0.6, musicVolume: 0.6, hold: 1.2 },
  recap: { beat: false, slowMo: false, transitions: ['dissolve'], stingerEvery: 0, volume: 0.35, musicVolume: 0.75, hold: 0 },
};

const STINGER = 0.8;

/** The words on a style's title open (also used for the wizard's preview). */
export function openText(styleId: ReelStyle, info: ReelInfo): { kicker: string; title: string; sub: string } {
  const team = REEL_STYLES.find((s) => s.id === styleId)!.subject === 'team';
  const name = info.name.trim() || (team ? 'Our Team' : 'Player Name');
  const num = info.number.trim().replace('#', '');
  const kicker =
    styleId === 'lineup'
      ? "TONIGHT'S"
      : styleId === 'spotlight'
        ? upper(info.headline || 'Player spotlight')
        : team
          ? info.season
            ? `SEASON ${info.season}`
            : 'SEASON RECAP'
          : [num && `#${num}`, upper(info.position)].filter(Boolean).join(' · ');
  const title = styleId === 'lineup' ? 'STARTING LINEUP' : upper(name);
  const sub =
    styleId === 'lineup'
      ? [upper(name), info.opponent.trim() && `vs ${upper(info.opponent)}`].filter(Boolean).join('  ')
      : team
        ? [info.record && `Record ${info.record}`, info.club].filter(Boolean).join('  ·  ')
        : styleId === 'spotlight'
          ? [num && `#${num}`, info.position, info.club || info.school].filter(Boolean).join('  ·  ')
          : [info.gradYear && `Class of ${info.gradYear}`, info.club, info.school].filter(Boolean).join('  ·  ');
  return { kicker, title, sub };
}

/** Opponent colours for both-team graphics: as chosen, or a pair that stands apart from ours. */
export function opponentColors(info: ReelInfo): [string, string] {
  if (info.oppColors) return info.oppColors;
  return TEAM_COLORS.find((c) => c.colors[0] !== info.colors[0] && c.colors[1] !== info.colors[1])?.colors ?? ['#b91c1c', '#f8fafc'];
}

/** A game's result from our side: totals, and whether we won. */
function resultOf(info: ReelInfo): { ours: number; theirs: number; won: boolean } | null {
  const sets = playedSets(info);
  if (!sets.length) return null;
  const [ours, theirs] = finalTotals(sportOf(info.sport), sets);
  return { ours, theirs, won: ours > theirs };
}

/**
 * The graphic a style opens with, in words (also drawn by the wizard's previews): a title open,
 * or the newer styles' own packages (versus, victory, award).
 */
export function titleGraphic(styleId: ReelStyle, info: ReelInfo): { type: GraphicType; text: Record<string, string>; oppColors?: [string, string]; versus: boolean } {
  const name = info.name.trim();
  const opp = (info.opponent ?? '').trim();
  if (styleId === 'matchup') {
    return {
      type: 'versus',
      text: { kicker: 'GAME DAY', usName: upper(name || 'Our Team'), themName: upper(opp || 'Opponent'), usSub: info.record ?? '', themSub: info.oppRecord ?? '', sub: [info.venue, info.club].filter((x) => x?.trim()).join('  ·  ') },
      oppColors: opponentColors(info),
      versus: true,
    };
  }
  if (styleId === 'victory') {
    const r = resultOf({ ...info, sets: info.sets ?? [] });
    return {
      type: 'victory',
      text: {
        kicker: r ? 'FINAL' : upper(info.season ? `Season ${info.season}` : 'Game day'),
        title: !r || r.won ? 'VICTORY' : upper(name || 'Our Team'),
        score: r ? `${r.ours}-${r.theirs}` : '',
        sub: opp ? `${upper(name || 'Our Team')} over ${upper(opp)}` : upper(name || 'Our Team'),
      },
      versus: true,
    };
  }
  if (styleId === 'potw') {
    const num = info.number.trim().replace('#', '');
    return {
      type: 'potw',
      text: { award: info.award?.trim() || 'Play of the Week', week: info.week?.trim() ?? '', name: upper(name || 'Player Name'), sub: [num && `#${num}`, info.position, info.club || info.school].filter(Boolean).join('  ·  ') },
      versus: false,
    };
  }
  return { type: 'open', text: openText(styleId, info), versus: styleId === 'lineup' };
}

/** Where a point of the source frame lands in the project frame, at the clip's first frame (fractions). */
function onScreen(clip: Clip, a: Asset, W: number, H: number, sx: number, sy: number): [number, number] {
  const tr = transformAt(clip, 0);
  const k = (clip.fit === 'cover' ? Math.max(W / a.width, H / a.height) : Math.min(W / a.width, H / a.height)) * tr.scale;
  const x = W / 2 + tr.x * W + (sx - 0.5) * a.width * k;
  const y = H / 2 + tr.y * H + (sy - 0.5) * a.height * k;
  return [x / W, y / H];
}

/** The analyst's marks for a replay: a circle round the player and an arrow in from the open side. */
function telestration(clip: Clip, a: Asset, W: number, H: number, at: { x: number; y: number }, color: string): TeleMark[] {
  const [fx, fy] = onScreen(clip, a, W, H, at.x, at.y);
  const S = Math.min(W, H);
  // Ring a player-sized area (players are roughly a fifth of the footage's height).
  const rPx = Math.max(S * 0.07, Math.min(S * 0.16, H * 0.085));
  const ring: TeleMark = { kind: 'circle', pts: [[fx, fy], [fx + rPx / W, fy]], color };
  // The arrow comes from whichever side has more room, from above.
  const dir = fx > 0.5 ? -1 : 1;
  const len = S * 0.22;
  const ang = Math.PI / 4;
  const tipX = fx * W + dir * Math.cos(ang) * rPx * 1.15;
  const tipY = fy * H - Math.sin(ang) * rPx * 1.15;
  const fromX = tipX + dir * Math.cos(ang) * len;
  const fromY = tipY - Math.sin(ang) * len;
  const clampF = (v: number) => Math.min(0.97, Math.max(0.03, v));
  const arrow: TeleMark = { kind: 'arrow', pts: [[clampF(fromX / W), clampF(fromY / H)], [tipX / W, tipY / H]], color };
  return [ring, arrow];
}

const splitName = (name: string): [string, string] => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? [parts.slice(0, -1).join(' '), parts[parts.length - 1]] : ['', parts[0] ?? ''];
};

export function buildBroadcastReel(raw: ReelInput, assets: Record<string, Asset>): Project {
  // Details saved by older versions may lack newer fields.
  const input: ReelInput = { ...raw, info: { ...raw.info, roster: raw.info.roster ?? [], opponent: raw.info.opponent ?? '', headline: raw.info.headline ?? '', sets: raw.info.sets ?? [], stats: raw.info.stats ?? [] } };
  const style = REEL_STYLES.find((s) => s.id === input.style)!;
  const look = LOOK[input.style];
  const [W, H] = style.aspect;
  const portrait = H > W;
  const { info, cards } = input;
  const team = style.subject === 'team';
  const name = info.name.trim() || (team ? 'Our Team' : 'Player Name');
  const num = info.number.trim().replace('#', '');
  const music = cards.music ? assets[cards.music] : undefined;
  const beat = music?.bpm ? 60 / music.bpm : 0;
  const fit = barFitter(beat * 4, look.beat);
  /** Half-bar lengths, for quicker sections that still cut on the beat. */
  const fitHalf = barFitter(beat * 2, look.beat);
  const has = (id?: string) => !!id && !!assets[id];
  const logo = has(cards.logo) ? cards.logo : undefined;
  const oppLogo = has(cards.oppLogo) ? cards.oppLogo : undefined;
  const cutouts = new Set(cards.cutouts ?? []);
  const [usName, themName] = sides(input, true);

  const sport = sportOf(info.sport);
  const spec = (type: GraphicType, text: Record<string, string>, extra: Partial<GraphicSpec> = {}): GraphicSpec => ({ type, colors: info.colors, text, logo, oppLogo, look: info.look, ...extra });
  const mediaSpec = (assetId?: string): Partial<GraphicSpec> =>
    assetId && assets[assetId]
      ? {
          media: assets[assetId].kind === 'video' ? 'video' : 'image',
          cutout: cutouts.has(assetId),
          // Still photos with a depth map come to life.
          depth: assets[assetId].kind === 'image' && !cutouts.has(assetId) && cards.depths?.[assetId] && assets[cards.depths[assetId]] ? cards.depths[assetId] : undefined,
        }
      : {};

  const potw = input.style === 'potw';
  const intros = style.roster === 'intros';
  const award = info.award?.trim() || 'Play of the Week';
  const projectName = team ? `${name} ${style.title}` : `${name} ${input.style === 'spotlight' ? info.headline || 'Spotlight' : potw ? award : 'Highlights'}`;
  let p: Project = { ...createProject(W, H, projectName), markers: [] };
  const overlays: Clip[] = [];
  /** Stingers: where, and in whose colours (the opponent's, going into their lineup). */
  const stingerAt: { t: number; extra?: Partial<GraphicSpec>; title?: string }[] = [];
  const end = () => (p.clips.length ? clipEnd(p.clips[p.clips.length - 1]) : 0);
  const full = (type: GraphicType, text: Record<string, string>, duration: number, extra: Partial<GraphicSpec> = {}, label = '', media?: string) => {
    p = appendToMain(p, createGraphicClip(spec(type, text, { ...extra, ...mediaSpec(media) }), 0, duration, label, media && assets[media] ? media : undefined));
  };
  const stinger = (extra?: Partial<GraphicSpec>, title?: string) => {
    if (p.clips.length) stingerAt.push({ t: end(), extra, title });
  };
  const oppColors = opponentColors(info);
  /** The opponent's look: their colours, with their logo in our logo's place. */
  const theirs: Partial<GraphicSpec> = { colors: oppColors, logo: oppLogo, oppLogo: logo };

  // ---------- open ----------
  const opening = titleGraphic(input.style, info);
  const openLen = opening.type === 'open' ? (input.style === 'hype' ? 3.2 : 4) : 4.6;
  const openDur = fit(openLen);
  // The cover: the title once it has finished building, before it wipes away.
  p.poster = +Math.min(openDur - 0.6, opening.type === 'open' ? 2.4 : 2.6).toFixed(2);
  full(opening.type, opening.text, openDur, { ...(opening.versus ? {} : { oppLogo: undefined }), ...(opening.oppColors ? { oppColors: opening.oppColors } : {}) }, opening.text.title || GRAPHIC_NAMES[opening.type]);

  // ---------- featured player card (player styles, when there's a photo or clip) ----------
  const [first, last] = splitName(name);
  const playerCard = () => {
    stinger();
    const detail =
      input.style === 'recruiting'
        ? [info.height, info.gradYear && `Class of ${info.gradYear}`, info.club, info.school].filter(Boolean).join('  ·  ')
        : [info.club, info.school].filter(Boolean).join('  ·  ');
    full('playerCard', { number: num, first, last, position: info.position, detail }, fit(4.4), {}, name, cards.photo);
  };
  // Play of the Week reveals the player after the replays.
  if (!team && !potw && (has(cards.photo) || input.style === 'recruiting')) playerCard();

  // ---------- roster wall (team reel) ----------
  const roster = info.roster.filter((r) => r.name.trim() || r.number.trim());
  if (input.style === 'team' && roster.length) {
    stinger();
    full(
      'roster',
      { title: 'The squad', sub: [name, info.season].filter(Boolean).join(' · ') },
      fit(Math.min(6, 3.5 + roster.length * 0.12)),
      { players: roster.map((r) => ({ number: r.number, name: r.name, photo: cards.players?.[r.key] && assets[cards.players[r.key]]?.kind === 'image' ? cards.players[r.key] : undefined })) },
    );
  }

  // ---------- starting lineup: one card per starter ----------
  const starterCards = (players: RosterPlayer[], len: number, extra: Partial<GraphicSpec> = {}) =>
    players.forEach((pl, i) => {
      const [f, l] = splitName(pl.name);
      full('playerCard', { number: pl.number.replace('#', ''), first: f, last: l, position: pl.position, count: `${i + 1}/${players.length}` }, len, extra, pl.name, cards.players?.[pl.key]);
    });
  if (input.style === 'lineup') {
    stinger();
    starterCards(roster.filter((r) => r.starter), fit(3.4));
  }
  // ---------- matchup: the visitors' starters in their colours, then ours (home goes last) ----------
  if (input.style === 'matchup') {
    const opp = info.opponent.trim() || 'Opponent';
    const visitors = (info.oppRoster ?? []).filter((r) => r.starter && (r.name.trim() || r.number.trim()));
    if (visitors.length) {
      stinger(theirs, upper(opp));
      full('open', { kicker: 'STARTING FOR', title: upper(opp), sub: info.oppRecord ? `Record ${info.oppRecord}` : '' }, fitHalf(3.2), { ...theirs, oppLogo: undefined }, upper(opp));
      // The visitors go by a little quicker.
      starterCards(visitors, fitHalf(3), theirs);
    }
    stinger();
    full('open', { kicker: visitors.length ? 'AND STARTING FOR' : 'STARTING FOR', title: upper(name), sub: info.record ? `Record ${info.record}` : '' }, fitHalf(3.2), { oppLogo: undefined }, upper(name));
    starterCards(roster.filter((r) => r.starter), fit(3.4));
  }

  // ---------- plays ----------
  const byKey = new Map(roster.map((r) => [r.key, r] as [string, RosterPlayer]));
  const playClips = intros ? [] : input.clips.filter((rc) => assets[rc.assetId]);
  if (playClips.length) stinger();
  const marker = num ? `#${num}` : upper(first || last);
  // Narrower frames: centre on the spotted player, or follow them or the action, or (4:5 without
  // any of those) letterbox. A followed player also gets a marker. Call once the timing is final.
  const frame = (clip: Clip, rc: ReelClip, a: Asset): Clip => {
    if (a.kind === 'video' && a.width && a.width / a.height > (W / H) * 1.05 && (portrait || rc.spotlight || rc.track)) {
      const frameW = (a.width / a.height) * (H / W);
      const slack = (frameW - 1) / 2;
      const at = rc.path?.length ? followAt(rc.path, clip.inPoint) : rc.spotlight;
      clip = { ...clip, fit: 'cover', transform: { ...clip.transform, x: Math.max(-slack, Math.min(slack, (0.5 - (at?.x ?? 0.5)) * frameW)) } };
      const path = rc.path?.length ? rc.path : !rc.spotlight ? rc.track : undefined;
      if (path?.length) {
        const keys = followKeyframes(clip, a, W, H, path);
        if (keys.length) clip = { ...clip, transform: { ...clip.transform, x: keys[0].v }, keyframes: { ...clip.keyframes, x: keys } };
      }
    }
    if (rc.path?.length && a.kind === 'video') clip = { ...clip, follow: { path: rc.path, color: info.colors[1], label: marker } };
    return clip;
  };
  /** Re-runs a play's decisive moment in slow motion behind a REPLAY wipe, optionally with the pen. */
  const addReplay = (rc: ReelClip, a: Asset, o: { speed: number; pen: boolean; tag: string; win?: number }) => {
    const available = Math.max(0.3, a.duration - rc.inPoint);
    const span = Math.min(rc.duration, available);
    const win = Math.min(o.win ?? 2.4, span);
    // The play's decisive moment is usually a little past its middle.
    const from = rc.inPoint + Math.max(0, Math.min(span - win, span * 0.62 - win / 2));
    const at = rc.path?.length ? followAt(rc.path, from) : rc.spotlight;
    const hold = at && o.pen ? 1.4 : 0;
    let r: Clip = { ...createMediaClip(a), inPoint: from, speed: o.speed, volume: 0, hold: hold || undefined, duration: hold + win / o.speed, transition: 'none' };
    // Beat-cut reels keep their cuts on the bar.
    r.duration = fit(r.duration, hold + Math.max(0.3, a.duration - from) / o.speed);
    r = frame(r, rc, a);
    const rStart = end();
    p = appendToMain(p, r);
    overlays.push(createGraphicClip(spec('replay', { tag: o.tag }), Math.max(0, rStart - 0.36), r.duration + 0.36, 'Replay'));
    if (at && hold) {
      const marks = telestration(r, a, W, H, at, info.colors[1]);
      overlays.push(createGraphicClip(spec('telestrator', {}, { marks }), rStart + 0.15, hold + 0.6, 'Telestrator'));
    }
  };
  // Play of the Week: the play once at full speed; every clip (other angles) comes back as a replay.
  let badgeFrom: number | null = null;
  playClips.forEach((rc, i) => {
    const a = assets[rc.assetId];
    if (potw && i > 0) {
      if (a.kind === 'video') addReplay(rc, a, { speed: 0.5, pen: !!(rc.spotlight || rc.path?.length), tag: `Angle ${i + 1}` });
      return;
    }
    const available = a.kind === 'image' ? Infinity : Math.max(0.3, a.duration - rc.inPoint);
    let clip: Clip = { ...createMediaClip(a), inPoint: a.kind === 'image' ? 0 : rc.inPoint, duration: Math.min(rc.duration, available), volume: look.volume };
    if (look.slowMo && clip.duration >= 2.5 && a.kind === 'video') {
      const hero = CURVE_PRESETS.find((c) => c.id === 'hero')!;
      clip.curve = { id: 'hero', points: hero.points.map((x) => ({ ...x })) };
      clip.duration = Math.min(durationForSpan(clip, clip.duration), durationForSpan(clip, available));
    }
    const hold = rc.spotlight && look.hold && a.kind === 'video' ? look.hold : 0;
    clip.duration = fit(clip.duration + hold, hold + (a.kind === 'image' ? Infinity : durationForSpan(clip, available)));
    if (hold) {
      clip.hold = hold;
      clip.spotlight = { x: rc.spotlight!.x, y: rc.spotlight!.y, r: 0.11, color: info.colors[1], label: num ? `#${num}` : upper(first || last), zoom: true };
    }
    clip = frame(clip, rc, a);
    const useStinger = look.stingerEvery > 0 && i > 0 && i % look.stingerEvery === 0;
    clip.transition = i === 0 || useStinger ? 'none' : look.transitions[i % look.transitions.length];
    clip.transitionDur = look.beat ? Math.min(0.3, beat || 0.3) : 0.4;
    if (useStinger) stinger();
    const start = end();
    badgeFrom ??= start;
    p = appendToMain(p, clip);
    clip = p.clips[p.clips.length - 1];

    // Player ID: who made the play and what it was.
    const who = rc.player ? byKey.get(rc.player) : undefined;
    const ltText: Record<string, string> | null = team
      ? who
        ? { number: who.number.replace('#', ''), name: who.name, detail: who.position, tag: rc.tag ?? '' }
        : rc.tag
          ? { number: '', name, detail: '', tag: rc.tag }
          : null
      : { number: num, name, detail: input.style === 'hype' ? '' : info.position, tag: rc.tag ?? '' };
    if (ltText && (input.style !== 'hype' || rc.tag || i === 0)) {
      const ltStart = start + hold + 0.15;
      const ltDur = Math.min(input.style === 'hype' ? 2.4 : 4, clip.duration - hold - 0.35);
      if (ltDur > 1) overlays.push(createGraphicClip(spec('lowerThird', ltText), ltStart, ltDur, ltText.name));
    }
    // Score bug for scored plays.
    const m = rc.score?.match(/^\s*(\d{1,2})\s*[-–:]\s*(\d{1,2})\s*$/);
    if (m) {
      const [us, them] = sides(input);
      overlays.push(createGraphicClip(spec('scoreBug', { usName: us, themName: them, us: m[1], them: m[2], set: rc.set ? String(rc.set) : '', periodLabel: sport.scoring.short }), start, clip.duration, `${m[1]}-${m[2]}`));
    }

    // Instant replay: the key moment again in slow motion, with the analyst's pen on the player.
    if ((rc.replay || potw) && a.kind === 'video') addReplay(rc, a, { speed: 0.5, pen: true, tag: rc.tag ?? (potw ? 'Angle 1' : '') });
  });

  if (potw && playClips.length) {
    const rc = playClips[0];
    const a = assets[rc.assetId];
    // One angle: run it back once more, slower still.
    if (a.kind === 'video' && playClips.length === 1) addReplay(rc, a, { speed: 0.3, pen: false, tag: 'Super slow-mo', win: 1.6 });
    if (badgeFrom !== null) overlays.push(createGraphicClip(spec('badge', { title: upper(award), sub: upper(info.week ?? '') }), badgeFrom, end() - badgeFrom, award));
    if (has(cards.photo)) playerCard();
  }

  // ---------- stats ----------
  const stats = info.stats.filter(([k, v]) => k.trim() && v.trim());
  if (stats.length && !intros) {
    stinger();
    const title = info.statsTitle || (input.style === 'spotlight' || potw ? 'By the numbers' : input.style === 'victory' ? 'Game stats' : team ? 'Team stats' : 'Season stats');
    full('stats', { title, sub: team ? [name, info.season].filter(Boolean).join(' · ') : [name, num && `#${num}`].filter(Boolean).join(' ') }, fit(Math.min(6.5, 3.6 + stats.length * 0.4)), { rows: stats });
  }

  // ---------- final score ----------
  const sets = playedSets(info);
  let cheerFrom: number | null = null;
  if (sets.length && !intros && !potw) {
    stinger();
    cheerFrom = end();
    const [ours, theirs] = finalTotals(sport, sets);
    const result = ours > theirs ? `${usName} win ${ours}-${theirs}` : ours < theirs ? `${themName} win ${theirs}-${ours}` : `Tied ${ours}-${theirs}`;
    full('final', { usName, themName, result, periodPrefix: sport.scoring.result === 'sets' ? 'S' : sport.scoring.short === 'INN' ? '' : sport.scoring.short[0], periodLabel: sport.scoring.short }, fit(5), { sets, scoring: sport.scoring.result }, 'Final');
  }

  // ---------- closer ----------
  stinger();
  cheerFrom ??= end();
  const closer: Record<string, string> =
    input.style === 'recruiting'
      ? { kicker: [num && `#${num}`, info.gradYear && `CLASS OF ${info.gradYear}`].filter(Boolean).join(' · '), title: upper(name), sub: [info.email, info.phone, [info.club, info.school].filter(Boolean).join(' · ')].filter(Boolean).join('\n') }
      : input.style === 'lineup'
        ? { kicker: "LET'S GO", title: `${upper(name)}!`, sub: info.opponent.trim() ? `vs ${info.opponent.trim()}` : '' }
        : input.style === 'team'
          ? { kicker: 'WE ARE', title: upper(name), sub: info.school }
          : input.style === 'recap'
            ? { kicker: 'THANK YOU', title: `GO ${upper(name)}!`, sub: [info.season && `Season ${info.season}`, info.record].filter(Boolean).join(' · ') }
            : input.style === 'spotlight'
              ? { kicker: upper(info.headline || 'Player spotlight'), title: upper(name), sub: [info.club, info.school].filter(Boolean).join(' · ') }
              : input.style === 'victory'
                ? { kicker: 'WE WIN', title: `${upper(name)}!`, sub: [info.record && `Record ${info.record}`, info.school].filter(Boolean).join(' · ') }
                : potw
                  ? { kicker: upper(award), title: upper(name), sub: [info.week, info.club || info.school].filter(Boolean).join(' · ') }
              : { kicker: num ? `#${num}` : '', title: upper(name), sub: [info.club, info.school].filter(Boolean).join(' · ') };
  if (input.style === 'matchup') full('versus', { ...opening.text, kicker: upper(sport.start), sub: [info.venue, info.club].filter((x) => x?.trim()).join('  ·  ') }, fit(4), { oppColors }, 'Face-off');
  else full('closer', closer, fit(input.style === 'recruiting' ? 5 : 4));
  const total = end();

  // ---------- overlays, stingers on their own top track, sound ----------
  for (const o of overlays) p = placeClip(p, o);
  if (stingerAt.length) {
    const added = addTrack(p, 'video');
    p = added.project;
    for (const { t, extra, title } of stingerAt) {
      const st = createGraphicClip(spec('stinger', { title: title ?? upper(name) }, extra), Math.max(0, t - STINGER / 2), STINGER, '');
      p = placeClip(p, st, added.track.id);
    }
  }
  // Cuts are timed in bars from the start, so start the song on a beat: skip the fraction of a
  // beat before its grid (recordings rarely begin exactly on one).
  const lead = music?.beats?.length && beat ? music.beats[0] % beat : 0;
  if (music) {
    const m = createMediaClip(music);
    m.start = 0;
    m.inPoint = lead;
    m.duration = Math.min(m.duration - lead, total);
    m.volume = look.musicVolume;
    m.audioFadeOut = Math.min(2.5, m.duration / 4);
    p = placeClip(p, m);
  }
  const whoosh = cards.whoosh ? assets[cards.whoosh] : undefined;
  if (whoosh) {
    const main = getMainTrack(p);
    const cuts = new Set(stingerAt.map(({ t }) => +t.toFixed(3)));
    if (look.beat) for (const c of p.clips) if (c.trackId === main.id && c.start > 0.5) cuts.add(+c.start.toFixed(3));
    for (const t of cuts) p = placeClip(p, { ...createMediaClip(whoosh), start: Math.max(0, t - 0.35), volume: 0.55, id: uid('c_') });
  }
  // The crowd rises under the result and the send-off (lineups are pre-game, so they stay quiet),
  // and a win opens to the crowd going wild.
  const crowd = cards.crowd ? assets[cards.crowd] : undefined;
  if (crowd && input.style === 'victory') {
    const first = p.clips.find((c) => c.graphic?.type === 'victory');
    if (first) {
      const c = { ...createMediaClip(crowd), start: 0.3, volume: 0.4, id: uid('c_') };
      c.duration = Math.min(crowd.duration, first.duration + 0.4);
      c.audioFadeIn = 0.2;
      c.audioFadeOut = Math.min(1.2, c.duration / 3);
      p = placeClip(p, c);
    }
  }
  if (crowd && !intros && cheerFrom !== null) {
    const from = Math.max(0, cheerFrom - 0.3);
    const c = { ...createMediaClip(crowd), start: from, volume: look.beat ? 0.35 : 0.45, id: uid('c_') };
    c.duration = Math.min(crowd.duration, total - from);
    c.audioFadeIn = Math.min(0.8, c.duration / 3);
    c.audioFadeOut = Math.min(2, c.duration / 3);
    p = placeClip(p, c);
  }
  // The slam lands with the title (VICTORY hits a beat later).
  if (cards.impact && assets[cards.impact]) p = placeClip(p, { ...createMediaClip(assets[cards.impact]), start: input.style === 'victory' ? 0.45 : 0.35, volume: look.beat ? 0.8 : 0.5 });
  if (music?.beats && music.bpm) {
    const onTimeline = music.beats.map((b) => b - lead).filter((t) => t >= -0.01);
    p = { ...p, markers: onTimeline.filter((t, i) => i % 4 === 0 && t < total).map((t) => ({ id: uid('m_'), t: Math.max(0, t), label: 'beat', color: '#00c2d1' })) };
  }
  return p;
}

