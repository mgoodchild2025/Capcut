import { contrastInk } from '../engine/render';
import { createMediaClip, createProject } from '../model/factory';
import { appendToMain, clipEnd, getMainTrack, placeClip } from '../model/ops';
import { CURVE_PRESETS, durationForSpan } from '../model/timing';
import type { Asset, Clip, Project, TransitionKind } from '../model/types';
import { uid } from '../utils';
import type { ReelInput, RosterPlayer } from './reel';
import { REEL_STYLES } from './reel';
import { appendFinalScore } from './match';
import { barFitter, card, follow, IMPACT, jersey, reframe, SANS, text, upper } from './shared';

/** Common set-up for the three newer styles: canvas, music grid and the overlay list. */
function begin(input: ReelInput, assets: Record<string, Asset>, title: string) {
  const style = REEL_STYLES.find((s) => s.id === input.style)!;
  const [W, H] = style.aspect;
  const music = input.cards.music ? assets[input.cards.music] : undefined;
  const beat = music?.bpm ? 60 / music.bpm : 0;
  return {
    W,
    H,
    music,
    beat,
    bar: beat * 4,
    p: { ...createProject(W, H, title), markers: [] } as Project,
    overlays: [] as Clip[],
  };
}

const lastEnd = (p: Project) => clipEnd(p.clips[p.clips.length - 1]);

/** Overlays onto text tracks, then music, whooshes on the cuts, an opening hit and bar markers. */
function finish(
  p: Project,
  overlays: Clip[],
  input: ReelInput,
  assets: Record<string, Asset>,
  music: Asset | undefined,
  opts: { musicVolume: number; whooshes: boolean },
): Project {
  const total = lastEnd(p);
  for (const o of overlays) p = placeClip(p, o);
  if (music) {
    const m = createMediaClip(music);
    m.start = 0;
    m.duration = Math.min(m.duration, total);
    m.volume = opts.musicVolume;
    m.audioFadeOut = Math.min(2.5, m.duration / 4);
    p = placeClip(p, m);
  }
  const { whoosh, impact } = input.cards;
  if (opts.whooshes && whoosh && assets[whoosh]) {
    const main = getMainTrack(p);
    const cuts = p.clips.filter((c) => c.trackId === main.id && c.start > 0.5).map((c) => c.start);
    for (const t of cuts) p = placeClip(p, { ...createMediaClip(assets[whoosh]), start: Math.max(0, t - 0.35), volume: 0.55, id: uid('c_') });
  }
  if (impact && assets[impact]) p = placeClip(p, { ...createMediaClip(assets[impact]), start: 0.25, volume: 0.7 });
  if (music?.beats && music.bpm) p = { ...p, markers: music.beats.filter((b, i) => i % 4 === 0 && b < total).map((t) => ({ id: uid('m_'), t, label: 'beat', color: '#00c2d1' })) };
  return p;
}

/** A game clip trimmed to the asset, with an optional "hero" slow-motion curve on longer plays. */
function playClip(a: Asset, inPoint: number, duration: number, volume: number, slowMo: boolean): { clip: Clip; available: number } {
  const available = a.kind === 'image' ? Infinity : Math.max(0.3, a.duration - inPoint);
  const clip: Clip = { ...createMediaClip(a), inPoint: a.kind === 'image' ? 0 : inPoint, duration: Math.min(duration, available), volume };
  if (slowMo && clip.duration >= 2.5 && a.kind === 'video') {
    const hero = CURVE_PRESETS.find((c) => c.id === 'hero')!;
    clip.curve = { id: 'hero', points: hero.points.map((x) => ({ ...x })) };
    clip.duration = Math.min(durationForSpan(clip, clip.duration), durationForSpan(clip, available));
  }
  return { clip, available };
}

const nameTag = (pl: Pick<RosterPlayer, 'number' | 'name'>) => [jersey(pl.number), upper(pl.name)].filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Player spotlight: 4:5 feed post celebrating one player.

export function buildSpotlightReel(input: ReelInput, assets: Record<string, Asset>): Project {
  const { info, cards } = input;
  const name = info.name.trim() || 'Player Name';
  const headline = upper(info.headline || 'Player spotlight');
  let { p, overlays, W, H, music } = begin(input, assets, `${name} ${info.headline || 'Spotlight'}`);
  const c2 = info.colors[1];
  const num = jersey(info.number);
  const intro = cards.players?.self ?? cards.intro;

  // Title: headline, name, position and team over the jersey-number card.
  const introDur = 3.6;
  p = appendToMain(p, card(assets[intro], introDur));
  const nameSize = Math.min(150, Math.round((900 / Math.max(6, name.length)) * 1.6));
  overlays.push(text(headline, 0.15, introDur - 0.15, { fontFamily: IMPACT, fontSize: 64, color: c2, bold: true }, 0, 0.12, { animIn: 'fade', animInDur: 0.4 }));
  overlays.push(text(upper(name), 0.3, introDur - 0.3, { fontFamily: IMPACT, fontSize: nameSize, bold: true, color: '#ffffff' }, 0, 0.22, { animIn: 'slide-up', animInDur: 0.5 }));
  const sub = [num, info.position, info.club || info.school].filter(Boolean).join('  ·  ');
  if (sub) overlays.push(text(upper(sub), 0.6, introDur - 0.6, { fontFamily: SANS, fontSize: 40, color: '#e5e7eb' }, 0, 0.31, { animIn: 'fade', animInDur: 0.5 }));

  // Plays: every one with the player ringed (when spotted) and a name tag.
  const transitions: TransitionKind[] = ['zoom', 'dissolve', 'slide-left', 'dissolve'];
  const tag = nameTag({ number: info.number, name });
  input.clips.forEach((rc, i) => {
    const a = assets[rc.assetId];
    if (!a) return;
    const made = playClip(a, rc.inPoint, rc.duration, 0.4, false);
    let clip = made.clip;
    const hold = rc.spotlight && a.kind === 'video' ? 1.2 : 0;
    if (hold) {
      clip.hold = hold;
      clip.duration += hold;
      clip.spotlight = { x: rc.spotlight!.x, y: rc.spotlight!.y, r: 0.11, color: c2, label: num || upper(name.split(' ')[0]), zoom: true };
    }
    // Wide footage fills the 4:5 frame when we know where the player is or where the action goes;
    // otherwise it's letterboxed.
    if (rc.spotlight) clip = reframe(clip, a, W, H, rc.spotlight.x);
    else if (rc.track) clip = follow(clip, a, W, H, rc.track);
    clip.transition = transitions[i % transitions.length];
    clip.transitionDur = 0.35;
    const start = lastEnd(p);
    p = appendToMain(p, clip);
    clip = p.clips[p.clips.length - 1];
    overlays.push(text(tag, start + 0.1, clip.duration - 0.2, { fontFamily: IMPACT, fontSize: 52, color: '#ffffff', background: 'rgba(0,0,0,0.55)', bold: true, shadow: false }, -0.2, 0.4, { animIn: 'slide-right', animInDur: 0.35 }));
    if (rc.tag) {
      overlays.push(
        text(upper(rc.tag), start + hold + 0.2, Math.min(2, clip.duration - hold - 0.3), { fontFamily: IMPACT, fontSize: 84, color: contrastInk(c2), background: c2, bold: true, shadow: false }, 0, -0.36, { animIn: 'pop', animInDur: 0.3, animOut: 'fade', animOutDur: 0.25 }),
      );
    }
  });

  // By the numbers.
  const stats = info.stats.filter(([k, v]) => k.trim() && v.trim());
  if (stats.length && cards.stats) {
    const start = lastEnd(p);
    const d = 4;
    const c = card(assets[cards.stats], d);
    c.transition = 'dissolve';
    c.transitionDur = 0.35;
    p = appendToMain(p, c);
    overlays.push(text('BY THE NUMBERS', start + 0.2, d - 0.2, { fontFamily: IMPACT, fontSize: 76, color: c2, bold: true }, 0, -0.26, { animIn: 'slide-down', animInDur: 0.45 }));
    const width = Math.max(...stats.map(([, v]) => v.length));
    overlays.push(
      text(stats.map(([k, v]) => `${v.padStart(width, ' ')}  ${k.toUpperCase()}`).join('\n'), start + 0.5, d - 0.5, { fontFamily: '"Courier New", monospace', fontSize: stats.length <= 3 ? 84 : 70, color: '#ffffff', align: 'left', bold: true }, 0, 0.04, { animIn: 'fade', animInDur: 0.5 }),
    );
  }

  p = appendFinalScore(p, overlays, input, assets, { duration: 3.6, transition: 'dissolve', portrait: true });

  // Send-off.
  {
    const start = lastEnd(p);
    const d = 3.8;
    const c = card(assets[intro], d);
    c.transition = 'dissolve';
    c.transitionDur = 0.4;
    p = appendToMain(p, c);
    overlays.push(text(headline, start + 0.2, d - 0.2, { fontFamily: IMPACT, fontSize: 60, color: c2, bold: true }, 0, 0.12, { animIn: 'fade', animInDur: 0.4 }));
    overlays.push(text(upper(name), start + 0.35, d - 0.35, { fontFamily: IMPACT, fontSize: nameSize, color: '#ffffff', bold: true }, 0, 0.22, { animIn: 'pop', animInDur: 0.45 }));
    const team = [info.club, info.school].filter(Boolean).join('  ·  ');
    if (team) overlays.push(text(team, start + 0.6, d - 0.6, { fontFamily: SANS, fontSize: 38, color: '#e5e7eb' }, 0, 0.31, { animIn: 'fade', animInDur: 0.5 }));
  }

  return finish(p, overlays, input, assets, music, { musicVolume: 0.7, whooshes: false });
}

// ---------------------------------------------------------------------------
// Team reel: 9:16 for the team account, plays credited to the roster.

export function buildTeamReel(input: ReelInput, assets: Record<string, Asset>): Project {
  const { info, cards } = input;
  const team = info.name.trim() || 'Our Team';
  let { p, overlays, W, H, music, beat, bar } = begin(input, assets, `${team} Team Reel`);
  const c2 = info.colors[1];
  const fit = barFitter(bar, true);
  const roster = info.roster.filter((r) => r.name.trim() || r.number.trim());
  const byKey = new Map(roster.map((r) => [r.key, r]));

  // Title.
  const introDur = fit(2.8);
  p = appendToMain(p, card(assets[cards.intro], introDur));
  const teamSize = Math.min(150, Math.round((900 / Math.max(6, team.length)) * 1.6));
  overlays.push(text(upper(info.season ? `Season ${info.season}` : 'Team reel'), 0.15, introDur - 0.15, { fontFamily: IMPACT, fontSize: 70, color: c2, bold: true }, 0, -0.195, { animIn: 'fade', animInDur: 0.4 }));
  overlays.push(text(upper(team), 0.25, introDur - 0.25, { fontFamily: IMPACT, fontSize: teamSize, bold: true, color: '#ffffff' }, 0, -0.12, { animIn: 'pop', animInDur: 0.5 }));
  const sub = [info.record && `Record ${info.record}`, info.club].filter(Boolean).join('  ·  ');
  if (sub) overlays.push(text(upper(sub), 0.55, introDur - 0.55, { fontFamily: SANS, fontSize: 44, color: '#e5e7eb' }, 0, -0.05, { animIn: 'fade', animInDur: 0.5 }));

  // The squad: numbers and names, two columns when the roster is long.
  if (roster.length && cards.roster) {
    const start = lastEnd(p);
    const d = fit(4.4);
    const c = card(assets[cards.roster], d);
    c.transition = 'flash';
    c.transitionDur = 0.3;
    p = appendToMain(p, c);
    overlays.push(text('THE SQUAD', start + 0.15, d - 0.15, { fontFamily: IMPACT, fontSize: 96, color: c2, bold: true }, 0, -0.33, { animIn: 'slide-down', animInDur: 0.4 }));
    const numW = Math.max(...roster.map((r) => jersey(r.number).length));
    const line = (r: RosterPlayer) => `${jersey(r.number).padEnd(numW, ' ')}  ${upper(r.name)}`;
    // One big column fits a typical roster on the tall frame; long rosters split in two.
    const cols = roster.length > 12 ? [roster.slice(0, Math.ceil(roster.length / 2)), roster.slice(Math.ceil(roster.length / 2))] : [roster];
    const longest = Math.max(...roster.map((r) => line(r).length));
    const rows = Math.ceil(roster.length / cols.length);
    const size = Math.round(Math.max(30, Math.min(76, ((cols.length === 2 ? 470 : 920) / Math.max(8, longest)) * 1.6, 1150 / (rows * 1.25))));
    cols.forEach((col, k) => {
      const x = cols.length === 2 ? (k === 0 ? -0.24 : 0.24) : 0;
      overlays.push(text(col.map(line).join('\n'), start + 0.4 + k * 0.15, d - 0.4 - k * 0.15, { fontFamily: '"Courier New", monospace', fontSize: size, color: '#ffffff', align: 'left', bold: true }, x, 0.03, { animIn: 'fade', animInDur: 0.45 }));
    });
  }

  // Plays, cut to the beat, each credited to whoever made it.
  const transitions: TransitionKind[] = ['flash', 'zoom', 'slide-left', 'blur'];
  input.clips.forEach((rc, i) => {
    const a = assets[rc.assetId];
    if (!a) return;
    const made = playClip(a, rc.inPoint, rc.duration, 0.15, true);
    let clip = made.clip;
    clip.duration = fit(clip.duration, a.kind === 'image' ? Infinity : durationForSpan(clip, made.available));
    clip = reframe(clip, a, W, H, rc.spotlight?.x ?? 0.5);
    if (!rc.spotlight) clip = follow(clip, a, W, H, rc.track);
    clip.transition = transitions[i % transitions.length];
    clip.transitionDur = Math.min(0.3, beat || 0.3);
    const start = lastEnd(p);
    p = appendToMain(p, clip);
    clip = p.clips[p.clips.length - 1];
    const who = rc.player ? byKey.get(rc.player) : undefined;
    const credit = [who && nameTag(who), rc.tag && upper(rc.tag)].filter(Boolean).join('  ·  ');
    if (credit) {
      overlays.push(
        text(credit, start + 0.2, Math.min(2.6, clip.duration - 0.3), { fontFamily: IMPACT, fontSize: 64, color: contrastInk(c2), background: c2, bold: true, shadow: false }, 0, 0.32, { animIn: 'pop', animInDur: 0.3, animOut: 'fade', animOutDur: 0.25 }),
      );
    }
  });

  // Team stats.
  const stats = info.stats.filter(([k, v]) => k.trim() && v.trim());
  if (stats.length && cards.stats) {
    const start = lastEnd(p);
    const d = fit(4);
    const c = card(assets[cards.stats], d);
    c.transition = 'flash';
    c.transitionDur = 0.35;
    p = appendToMain(p, c);
    overlays.push(text('TEAM STATS', start + 0.2, d - 0.2, { fontFamily: IMPACT, fontSize: 84, color: c2, bold: true }, 0, -0.18, { animIn: 'slide-down', animInDur: 0.45 }));
    const width = Math.max(...stats.map(([, v]) => v.length));
    overlays.push(
      text(stats.map(([k, v]) => `${v.padStart(width, ' ')}  ${k.toUpperCase()}`).join('\n'), start + 0.5, d - 0.5, { fontFamily: '"Courier New", monospace', fontSize: stats.length <= 3 ? 86 : 70, color: '#ffffff', align: 'left', bold: true }, 0, 0.02, { animIn: 'fade', animInDur: 0.5 }),
    );
  }

  p = appendFinalScore(p, overlays, input, assets, { duration: fit(3.6), transition: 'flash', portrait: true });

  // We are...
  {
    const start = lastEnd(p);
    const d = fit(3.6);
    const c = card(assets[cards.outro], d);
    c.transition = 'flash';
    c.transitionDur = 0.4;
    p = appendToMain(p, c);
    overlays.push(text('WE ARE', start + 0.2, d - 0.2, { fontFamily: IMPACT, fontSize: 80, color: c2, bold: true }, 0, -0.17, { animIn: 'fade', animInDur: 0.35 }));
    overlays.push(text(upper(team), start + 0.4, d - 0.4, { fontFamily: IMPACT, fontSize: teamSize, color: '#ffffff', bold: true }, 0, -0.08, { animIn: 'pop', animInDur: 0.45 }));
    if (info.school) overlays.push(text(info.school, start + 0.7, d - 0.7, { fontFamily: SANS, fontSize: 44, color: '#e5e7eb' }, 0, 0.02, { animIn: 'fade', animInDur: 0.5 }));
  }

  return finish(p, overlays, input, assets, music, { musicVolume: 0.9, whooshes: true });
}

// ---------------------------------------------------------------------------
// Starting lineup: pre-game introductions, one starter per beat-timed segment.

export function buildLineupReel(input: ReelInput, assets: Record<string, Asset>): Project {
  const { info, cards } = input;
  const team = info.name.trim() || 'Our Team';
  let { p, overlays, W, H, music, bar } = begin(input, assets, `${team} Starting Lineup`);
  const c2 = info.colors[1];
  const fit = barFitter(bar, true);
  const starters = info.roster.filter((r) => r.starter && (r.name.trim() || r.number.trim()));

  // Tonight's starting lineup.
  const introDur = fit(3.8);
  p = appendToMain(p, card(assets[cards.intro], introDur));
  overlays.push(text("TONIGHT'S", 0.1, introDur - 0.1, { fontFamily: IMPACT, fontSize: 80, color: c2, bold: true }, 0, -0.2, { animIn: 'fade', animInDur: 0.35 }));
  overlays.push(text('STARTING\nLINEUP', 0.35, introDur - 0.35, { fontFamily: IMPACT, fontSize: 170, color: '#ffffff', bold: true }, 0, -0.06, { animIn: 'pop', animInDur: 0.45 }));
  const vs = [upper(team), info.opponent.trim() && `VS ${upper(info.opponent)}`].filter(Boolean).join('\n');
  overlays.push(text(vs, 0.8, introDur - 0.8, { fontFamily: SANS, fontSize: 48, color: '#e5e7eb', bold: true }, 0, 0.1, { animIn: 'fade', animInDur: 0.5 }));

  // One reveal per starter.
  starters.forEach((pl, i) => {
    const d = fit(3.2);
    const media = pl.assetId ? assets[pl.assetId] : undefined;
    const bg = media ?? (cards.players?.[pl.key] ? assets[cards.players[pl.key]] : undefined) ?? assets[cards.intro];
    let clip: Clip;
    if (bg.kind === 'video') {
      // Clips shorter than the segment play in slow motion to fill it.
      const speed = Math.max(0.25, Math.min(1, bg.duration / d));
      clip = reframe({ ...createMediaClip(bg), inPoint: 0, speed, duration: Math.min(d, bg.duration / speed), volume: 0 }, bg, W, H);
    } else {
      clip = card(bg, d);
      // A slow push-in brings photos to life.
      if (media) clip.keyframes = { scale: [{ t: 0, v: 1 }, { t: d, v: 1.12 }] };
    }
    clip.transition = 'flash';
    clip.transitionDur = 0.3;
    const start = lastEnd(p);
    p = appendToMain(p, clip);
    const seg = p.clips[p.clips.length - 1].duration;
    const photo = !!media;
    const y0 = photo ? 0.16 : 0.1;
    if (pl.number.trim())
      overlays.push(text(jersey(pl.number), start + 0.15, seg - 0.15, { fontFamily: IMPACT, fontSize: photo ? 150 : 120, color: c2, bold: true }, 0, y0, { animIn: 'pop', animInDur: 0.35 }));
    const parts = pl.name.trim().split(/\s+/);
    const nm = parts.length > 1 ? `${upper(parts.slice(0, -1).join(' '))}\n${upper(parts[parts.length - 1])}` : upper(pl.name);
    const longest = Math.max(...nm.split('\n').map((s) => s.length));
    overlays.push(text(nm, start + 0.35, seg - 0.35, { fontFamily: IMPACT, fontSize: Math.min(150, Math.round((900 / Math.max(5, longest)) * 1.5)), color: '#ffffff', bold: true }, 0, y0 + 0.13, { animIn: 'slide-up', animInDur: 0.4 }));
    if (pl.position) overlays.push(text(upper(pl.position), start + 0.6, seg - 0.6, { fontFamily: SANS, fontSize: 46, color: '#e5e7eb', background: 'rgba(0,0,0,0.45)', bold: true, shadow: false }, 0, y0 + 0.25, { animIn: 'fade', animInDur: 0.4 }));
    overlays.push(text(`${i + 1}/${starters.length}`, start + 0.2, seg - 0.2, { fontFamily: SANS, fontSize: 30, color: '#cbd5e1', shadow: false }, 0.38, -0.44, { animIn: 'fade', animInDur: 0.3 }));
  });

  // Let's go!
  {
    const start = lastEnd(p);
    const d = fit(3.4);
    const c = card(assets[cards.outro], d);
    c.transition = 'flash';
    c.transitionDur = 0.35;
    p = appendToMain(p, c);
    overlays.push(text("LET'S GO", start + 0.15, d - 0.15, { fontFamily: IMPACT, fontSize: 110, color: c2, bold: true }, 0, -0.16, { animIn: 'pop', animInDur: 0.35 }));
    overlays.push(text(`${upper(team)}!`, start + 0.35, d - 0.35, { fontFamily: IMPACT, fontSize: Math.min(160, Math.round((900 / Math.max(6, team.length)) * 1.6)), color: '#ffffff', bold: true }, 0, -0.04, { animIn: 'pop', animInDur: 0.45 }));
  }

  return finish(p, overlays, input, assets, music, { musicVolume: 0.95, whooshes: true });
}
