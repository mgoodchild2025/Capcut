import { createMediaClip } from '../model/factory';
import { appendToMain, clipEnd, getMainTrack, placeClip } from '../model/ops';
import type { Asset, Clip, Project, TransitionKind } from '../model/types';
import type { ReelInfo, ReelInput } from './reel';
import { IMPACT, SANS, text, upper } from './shared';

/** Set scores that have both numbers filled in, as [ours, theirs]. */
export function playedSets(info: ReelInfo): [number, number][] {
  return (info.sets ?? [])
    .map(([a, b]) => [parseInt(a, 10), parseInt(b, 10)] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

/** Short names for the score bug: the team (or the player's club) and the opponent. */
export function sides(input: ReelInput, full = false): [string, string] {
  const { info } = input;
  const team = input.style === 'team' || input.style === 'lineup' || input.style === 'recap' ? info.name : info.club || info.school;
  // Long names lose whole trailing words ("ROCKETS 17 ELITE" -> "ROCKETS 17") so the bug stays compact.
  const short = (s: string, fallback: string) => {
    if (full) return upper(s || fallback);
    const words = upper(s || fallback).split(/\s+/);
    let out = words[0].slice(0, 12);
    for (const w of words.slice(1)) {
      if (`${out} ${w}`.length > 12) break;
      out = `${out} ${w}`;
    }
    return out;
  };
  return [short(team, 'Home'), short(info.opponent, 'Away')];
}

/** "Final" card: sets won, the winner and each set's score. Goes just before the send-off. */
export function appendFinalScore(
  p: Project,
  overlays: Clip[],
  input: ReelInput,
  assets: Record<string, Asset>,
  opts: { duration: number; transition: TransitionKind; portrait: boolean },
): Project {
  const sets = playedSets(input.info);
  const bg = input.cards.final ? assets[input.cards.final] : undefined;
  if (!sets.length || !bg) return p;
  const won = sets.filter(([a, b]) => a > b).length;
  const lost = sets.length - won;
  const [us, them] = sides(input, true);
  const c2 = input.info.colors[1];
  const start = clipEnd(p.clips[p.clips.length - 1]);
  const d = opts.duration;
  p = appendToMain(p, { ...createMediaClip(bg), duration: d, fit: 'cover', transition: opts.transition, transitionDur: 0.35 });
  const y = opts.portrait ? -0.06 : 0;
  overlays.push(text('FINAL', start + 0.15, d - 0.15, { fontFamily: IMPACT, fontSize: 80, color: c2, bold: true }, 0, y - 0.2, { animIn: 'fade', animInDur: 0.35 }));
  overlays.push(text(`${won} – ${lost}`, start + 0.3, d - 0.3, { fontFamily: IMPACT, fontSize: 230, color: '#ffffff', bold: true }, 0, y - 0.04, { animIn: 'pop', animInDur: 0.45 }));
  const result = won > lost ? `${us} WIN\nvs ${them}` : `${us}\nvs ${them}`;
  overlays.push(text(result, start + 0.55, d - 0.55, { fontFamily: SANS, fontSize: 44, color: '#ffffff', bold: true }, 0, y + (opts.portrait ? 0.1 : 0.14), { animIn: 'fade', animInDur: 0.4 }));
  overlays.push(text(sets.map(([a, b]) => `${a}–${b}`).join('   '), start + 0.75, d - 0.75, { fontFamily: SANS, fontSize: 40, color: c2, bold: true }, 0, y + (opts.portrait ? 0.19 : 0.3), { animIn: 'fade', animInDur: 0.4 }));
  return p;
}

/** Fits an image (the logo) inside a box of `boxH` by `boxW` pixels and pins it to a corner. */
function logoClip(logo: Asset, W: number, H: number, start: number, duration: number, boxH: number, boxW: number, corner: 'tl' | 'tr', opacity: number): Clip {
  const fit = Math.min(W / logo.width, H / logo.height);
  const scale = Math.min(boxH / (logo.height * fit), boxW / (logo.width * fit));
  const w = logo.width * fit * scale;
  const h = logo.height * fit * scale;
  const margin = Math.min(W, H) * 0.045;
  const x = corner === 'tl' ? (margin + w / 2) / W - 0.5 : 0.5 - (margin + w / 2) / W;
  const c = createMediaClip(logo);
  return {
    ...c,
    start,
    duration,
    transform: { ...c.transform, scale, x, y: (margin + h / 2) / H - 0.5, opacity },
    animIn: 'fade',
    animInDur: 0.3,
  };
}

/**
 * Adds what every style shares once the edit is laid out: the team logo on title cards and as a
 * corner badge during the plays, and a score bug on each play that has a score.
 */
export function decorate(p: Project, input: ReelInput, assets: Record<string, Asset>): Project {
  const { W, H } = { W: p.settings.width, H: p.settings.height };
  const S = Math.min(W, H);
  const { cards, info } = input;
  const main = p.clips.filter((c) => c.trackId === getMainTrack(p).id).sort((a, b) => a.start - b.start);
  const titleCards = new Set([cards.intro, cards.outro, cards.roster, ...Object.values(cards.players ?? {})].filter(Boolean));
  const otherCards = new Set([cards.info, cards.stats, cards.final].filter(Boolean));
  const plays = main.filter((c) => c.assetId && !titleCards.has(c.assetId) && !otherCards.has(c.assetId));
  const extra: Clip[] = [];

  const logo = cards.logo ? assets[cards.logo] : undefined;
  if (logo && logo.width && logo.height) {
    for (const c of main) if (c.assetId && titleCards.has(c.assetId)) extra.push(logoClip(logo, W, H, c.start, c.duration, S * 0.15, S * 0.32, 'tl', 1));
    if (info.badge && plays.length) {
      const from = plays[0].start;
      const to = clipEnd(plays[plays.length - 1]);
      // The lineup's starter counter sits top right, so its badge goes top left.
      extra.push(logoClip(logo, W, H, from, to - from, S * 0.085, S * 0.2, input.style === 'lineup' ? 'tl' : 'tr', 0.9));
    }
  }

  // Score bugs. Plays are laid out in the order they were picked, skipping missing media.
  if (input.style !== 'lineup') {
    const picked = input.clips.filter((rc) => assets[rc.assetId]);
    const [us, them] = sides(input);
    picked.forEach((rc, i) => {
      const clip = plays[i];
      const m = rc.score?.match(/^\s*(\d{1,2})\s*[-–:]\s*(\d{1,2})\s*$/);
      if (!clip || !m) return;
      const label = `${rc.set ? `S${rc.set}   ` : ''}${us}  ${m[1]}–${m[2]}  ${them}`;
      // Top centre, clear of the corner badge; the 4:5 spotlight has its skill label up there, so its bug sits at the bottom.
      const y = W > H ? -0.45 : H / W < 1.5 ? 0.465 : -0.41;
      extra.push(
        text(label, clip.start, clip.duration, { fontFamily: SANS, fontSize: W > H ? 34 : 36, color: '#ffffff', background: 'rgba(8,8,12,0.72)', bold: true, shadow: false }, 0, y, {
          animIn: 'slide-down',
          animInDur: 0.3,
        }),
      );
    });
  }

  for (const c of extra) p = placeClip(p, c);
  return p;
}
