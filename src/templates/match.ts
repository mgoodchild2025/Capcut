import { REEL_STYLES, type ReelInfo, type ReelInput } from './reel';
import { upper } from './shared';

/** Set scores that have both numbers filled in, as [ours, theirs]. */
export function playedSets(info: ReelInfo): [number, number][] {
  return (info.sets ?? [])
    .map(([a, b]) => [parseInt(a, 10), parseInt(b, 10)] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

/** Short names for the score bug: the team (or the player's club) and the opponent. */
export function sides(input: ReelInput, full = false): [string, string] {
  const { info } = input;
  const team = REEL_STYLES.find((s) => s.id === input.style)?.subject === 'team' ? info.name : info.club || info.school;
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
