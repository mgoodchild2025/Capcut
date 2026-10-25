/**
 * Scoring and statistics from a tagged match: the running score and sets, who served, our rotation,
 * and each player's line (volleyball's box score; other sports count their plays). Pure functions.
 */
import type { MatchData, MatchRally, RallyAction } from '../model/types';

export type Side = 'us' | 'them';

/** A one-tap tag: a skill, its result, and the point it ends with (if it ends one). */
export interface QuickTag {
  id: string;
  label: string;
  skill: string;
  result: string;
  point?: Side;
  /** For the other team (no player). */
  team?: boolean;
}

export const VOLLEY_TAGS: QuickTag[] = [
  { id: 'kill', label: 'Kill', skill: 'attack', result: 'kill', point: 'us' },
  { id: 'attack', label: 'Attack', skill: 'attack', result: 'in' },
  { id: 'attack-error', label: 'Hit error', skill: 'attack', result: 'error', point: 'them' },
  { id: 'blocked', label: 'Blocked', skill: 'attack', result: 'blocked', point: 'them' },
  { id: 'ace', label: 'Ace', skill: 'serve', result: 'ace', point: 'us' },
  { id: 'serve', label: 'Serve in', skill: 'serve', result: 'in' },
  { id: 'serve-error', label: 'Serve error', skill: 'serve', result: 'error', point: 'them' },
  { id: 'pass3', label: 'Pass 3', skill: 'pass', result: '3' },
  { id: 'pass2', label: 'Pass 2', skill: 'pass', result: '2' },
  { id: 'pass1', label: 'Pass 1', skill: 'pass', result: '1' },
  { id: 'pass0', label: 'Aced', skill: 'pass', result: '0', point: 'them' },
  { id: 'assist', label: 'Assist', skill: 'set', result: 'assist' },
  { id: 'set-error', label: 'Set error', skill: 'set', result: 'error', point: 'them' },
  { id: 'block', label: 'Block', skill: 'block', result: 'solo', point: 'us' },
  { id: 'block-assist', label: 'Block assist', skill: 'block', result: 'assist', point: 'us' },
  { id: 'block-error', label: 'Block error', skill: 'block', result: 'error', point: 'them' },
  { id: 'dig', label: 'Dig', skill: 'dig', result: 'dig' },
  { id: 'dig-error', label: 'Dig error', skill: 'dig', result: 'error', point: 'them' },
];

/** The other team's side of things, tagged without a player. */
export const OPP_TAGS: QuickTag[] = [
  { id: 'opp-error', label: 'Their error', skill: 'opp', result: 'error', point: 'us', team: true },
  { id: 'opp-kill', label: 'Their kill', skill: 'opp', result: 'kill', point: 'them', team: true },
  { id: 'opp-ace', label: 'Their ace', skill: 'opp', result: 'ace', point: 'them', team: true },
  { id: 'opp-block', label: 'Their block', skill: 'opp', result: 'block', point: 'them', team: true },
];

/** The point a tagged action ends with, if any. */
export function pointOf(a: Pick<RallyAction, 'skill' | 'result'>): Side | undefined {
  return [...VOLLEY_TAGS, ...OPP_TAGS].find((t) => t.skill === a.skill && t.result === a.result)?.point;
}

export interface RallyScore {
  rallyId: string;
  set: number;
  /** Score before and after the rally (ours, theirs), within its set. */
  before: [number, number];
  after: [number, number];
  serving?: Side;
  /** Our rotation (1..6) during the rally, volleyball only. */
  rotation?: number;
  /** We received serve and won the point. */
  sideout?: boolean;
}

export interface MatchScore {
  rallies: RallyScore[];
  /** Finished and current sets, (ours, theirs). */
  sets: [number, number][];
  /** Sets won by each side. */
  won: [number, number];
}

/** Volleyball sets go to 25 (the fifth to 15), won by two. */
const setOver = (set: number, us: number, them: number) => {
  const target = set >= 5 ? 15 : 25;
  return Math.max(us, them) >= target && Math.abs(us - them) >= 2;
};

/** Who served a rally, from what was tagged: our serve, or our pass of theirs. */
function servedBy(r: MatchRally): Side | undefined {
  for (const a of r.actions ?? []) {
    if (a.skill === 'serve' && a.player) return 'us';
    if (a.skill === 'pass' && a.player) return 'them';
    if (a.skill === 'opp' && a.result === 'ace') return 'them';
  }
  return undefined;
}

/** The running score, sets, serve and rotation through a match. Untagged rallies don't move the score. */
export function scoreMatch(m: MatchData, sets = true): MatchScore {
  const rallies = m.rallies.slice().sort((a, b) => a.start - b.start);
  const out: RallyScore[] = [];
  const done: [number, number][] = [];
  let set = 1;
  let us = 0;
  let them = 0;
  let lastWinner: Side | undefined;
  let rotation = 1;
  const firstServe = (n: number): Side | undefined => (m.serveFirst ? (n % 2 === 1 ? m.serveFirst : m.serveFirst === 'us' ? 'them' : 'us') : undefined);
  for (const r of rallies) {
    const serving = servedBy(r) ?? lastWinner ?? firstServe(set);
    const before: [number, number] = [us, them];
    const rot = sets ? rotation : undefined;
    let sideout = false;
    if (r.won === 'us') us++;
    else if (r.won === 'them') them++;
    if (r.won) {
      sideout = r.won === 'us' && serving === 'them';
      if (sets && sideout) rotation = (rotation % 6) + 1;
      lastWinner = r.won;
    }
    out.push({ rallyId: r.id, set, before, after: [us, them], serving, rotation: rot, sideout });
    if (sets && r.won && setOver(set, us, them)) {
      done.push([us, them]);
      set++;
      us = 0;
      them = 0;
      lastWinner = undefined;
      rotation = 1;
    }
  }
  const all: [number, number][] = us || them || !done.length ? [...done, [us, them]] : done;
  const finished = done;
  return {
    rallies: out,
    sets: sets ? all : [[us, them]],
    won: [finished.filter(([a, b]) => a > b).length, finished.filter(([a, b]) => b > a).length],
  };
}

/** One player's volleyball line. */
export interface VolleyLine {
  kills: number;
  attackErrors: number;
  attempts: number;
  /** (kills - errors) / attempts, or null with no attempts. */
  hitting: number | null;
  aces: number;
  serveErrors: number;
  serves: number;
  receptions: number;
  /** Average pass, 0..3. */
  passRating: number | null;
  receptionErrors: number;
  assists: number;
  setErrors: number;
  blockSolos: number;
  blockAssists: number;
  blockErrors: number;
  digs: number;
  digErrors: number;
  /** Kills + aces + solo blocks + half of block assists. */
  points: number;
}

const blank = (): VolleyLine => ({
  kills: 0,
  attackErrors: 0,
  attempts: 0,
  hitting: null,
  aces: 0,
  serveErrors: 0,
  serves: 0,
  receptions: 0,
  passRating: null,
  receptionErrors: 0,
  assists: 0,
  setErrors: 0,
  blockSolos: 0,
  blockAssists: 0,
  blockErrors: 0,
  digs: 0,
  digErrors: 0,
  points: 0,
});

/** Adds one action to a line. */
function add(l: VolleyLine, a: RallyAction, passSum: { v: number }) {
  if (a.skill === 'attack') {
    l.attempts++;
    if (a.result === 'kill') l.kills++;
    if (a.result === 'error' || a.result === 'blocked') l.attackErrors++;
  } else if (a.skill === 'serve') {
    l.serves++;
    if (a.result === 'ace') l.aces++;
    if (a.result === 'error') l.serveErrors++;
  } else if (a.skill === 'pass') {
    l.receptions++;
    passSum.v += Number(a.result) || 0;
    if (a.result === '0') l.receptionErrors++;
  } else if (a.skill === 'set') {
    if (a.result === 'assist') l.assists++;
    if (a.result === 'error') l.setErrors++;
  } else if (a.skill === 'block') {
    if (a.result === 'solo') l.blockSolos++;
    if (a.result === 'assist') l.blockAssists++;
    if (a.result === 'error') l.blockErrors++;
  } else if (a.skill === 'dig') {
    if (a.result === 'dig') l.digs++;
    if (a.result === 'error') l.digErrors++;
  }
}

function finish(l: VolleyLine, passSum: number): VolleyLine {
  l.hitting = l.attempts ? (l.kills - l.attackErrors) / l.attempts : null;
  l.passRating = l.receptions ? passSum / l.receptions : null;
  l.points = l.kills + l.aces + l.blockSolos + l.blockAssists / 2;
  return l;
}

export interface VolleyStats {
  players: Map<string, VolleyLine>;
  team: VolleyLine;
  /** Points the other team gave away, and how they scored theirs. */
  oppErrors: number;
  oppKills: number;
  oppAces: number;
  oppBlocks: number;
  /** Receiving: points won / points played; serving likewise. */
  sideout: [number, number];
  pointScoring: [number, number];
  /** Our rotations 1..6: points won and lost in each. */
  rotations: [number, number][];
}

export function volleyStats(m: MatchData): VolleyStats {
  const players = new Map<string, VolleyLine>();
  const sums = new Map<string, { v: number }>();
  const team = blank();
  const teamSum = { v: 0 };
  let oppErrors = 0;
  let oppKills = 0;
  let oppAces = 0;
  let oppBlocks = 0;
  for (const r of m.rallies) {
    for (const a of r.actions ?? []) {
      if (a.skill === 'opp') {
        if (a.result === 'error') oppErrors++;
        if (a.result === 'kill') oppKills++;
        if (a.result === 'ace') oppAces++;
        if (a.result === 'block') oppBlocks++;
        continue;
      }
      if (!a.player) continue;
      if (!players.has(a.player)) {
        players.set(a.player, blank());
        sums.set(a.player, { v: 0 });
      }
      add(players.get(a.player)!, a, sums.get(a.player)!);
      add(team, a, teamSum);
    }
  }
  for (const [k, l] of players) finish(l, sums.get(k)!.v);
  finish(team, teamSum.v);
  const score = scoreMatch(m);
  const sideout: [number, number] = [0, 0];
  const pointScoring: [number, number] = [0, 0];
  const rotations: [number, number][] = Array.from({ length: 6 }, () => [0, 0]);
  const won = new Map(m.rallies.map((r) => [r.id, r.won]));
  for (const s of score.rallies) {
    const w = won.get(s.rallyId);
    if (!w) continue;
    if (s.serving === 'them') {
      sideout[1]++;
      if (w === 'us') sideout[0]++;
    } else if (s.serving === 'us') {
      pointScoring[1]++;
      if (w === 'us') pointScoring[0]++;
    }
    if (s.rotation) rotations[s.rotation - 1][w === 'us' ? 0 : 1]++;
  }
  return { players, team, oppErrors, oppKills, oppAces, oppBlocks, sideout, pointScoring, rotations };
}

/** Other sports: how many of each play each player made. */
export function playCounts(m: MatchData): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of m.rallies)
    for (const a of r.actions ?? []) {
      if (!a.player || a.skill === 'opp') continue;
      const row = out.get(a.player) ?? new Map<string, number>();
      row.set(a.skill, (row.get(a.skill) ?? 0) + 1);
      out.set(a.player, row);
    }
  return out;
}

/** The rallies with an action matching `test` (a stat's plays, to watch). */
export function ralliesWith(m: MatchData, test: (a: RallyAction) => boolean): MatchRally[] {
  return m.rallies.filter((r) => (r.actions ?? []).some(test)).sort((a, b) => a.start - b.start);
}

/** "0.315" style, as volleyball prints hitting percentage; a dash with no attempts. */
export const pct3 = (v: number | null) => (v === null ? '–' : `${v < 0 ? '-' : ''}.${String(Math.round(Math.abs(v) * 1000)).padStart(3, '0')}`.replace('.1000', '1.000'));

export interface Leader {
  label: string;
  value: string;
  player: string;
}

/** Who led the team: the top player in each headline stat (volleyball), or in each play (other sports). */
export function gameLeaders(m: MatchData, volley: boolean): Leader[] {
  const top = (lines: [string, number][], label: string, show = (v: number) => String(v)): Leader | null => {
    const best = lines.reduce<[string, number] | null>((b, x) => (x[1] > (b?.[1] ?? 0) ? x : b), null);
    return best ? { label, value: show(best[1]), player: best[0] } : null;
  };
  if (!volley) {
    const counts = playCounts(m);
    const plays = [...new Set([...counts.values()].flatMap((c) => [...c.keys()]))];
    return plays
      .map((k) => top([...counts].map(([p, c]) => [p, c.get(k) ?? 0]), k))
      .filter((l): l is Leader => !!l)
      .slice(0, 5);
  }
  const lines = [...volleyStats(m).players];
  const of = (f: (l: VolleyLine) => number): [string, number][] => lines.map(([p, l]) => [p, f(l)]);
  return [
    top(of((l) => l.kills), 'Kills'),
    top(of((l) => l.aces), 'Aces'),
    top(of((l) => l.blockSolos + l.blockAssists / 2), 'Blocks'),
    top(of((l) => l.digs), 'Digs'),
    top(of((l) => l.assists), 'Assists'),
  ].filter((l): l is Leader => !!l);
}

/** The final score in a line: sets won (and each set), or points. `partial` when the game is only partly tagged. */
export function finalScore(score: MatchScore, volley: boolean): { us: number; them: number; sets: [number, number][]; partial: boolean } {
  const played = score.sets.filter(([a, b]) => a + b > 0);
  // A single unfinished set reads better as its points.
  if (volley && (score.won[0] + score.won[1] > 0 || played.length !== 1)) return { us: score.won[0], them: score.won[1], sets: played, partial: false };
  const [us, them] = played.reduce<[number, number]>(([x, y], [a, b]) => [x + a, y + b], [0, 0]);
  return { us, them, sets: [], partial: volley };
}
