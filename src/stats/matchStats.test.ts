import { describe, expect, it } from 'vitest';
import type { MatchData, MatchRally, RallyAction } from '../model/types';
import { summarySpec } from '../templates/posters';
import { BLANK } from '../components/ReelWizard';
import { finalScore, gameLeaders, pct3, playCounts, pointOf, ralliesWith, scoreMatch, volleyStats } from './matchStats';

let n = 0;
const act = (player: string | undefined, skill: string, result: string): RallyAction => ({ id: `a${n++}`, player, skill, result });
const rally = (i: number, won?: 'us' | 'them', actions: RallyAction[] = []): MatchRally => ({ id: `r${i}`, start: i * 20, end: i * 20 + 8, peak: i * 20 + 4, score: 50, reasons: [], won, actions });

describe('scoring a tagged match', () => {
  it('keeps the score, ends sets at 25 by two, and counts sets won', () => {
    // Set 1: we win 25-23; set 2: they lead 3-1.
    const r: MatchRally[] = [];
    let i = 0;
    for (let k = 0; k < 23; k++) r.push(rally(i++, 'us'), rally(i++, 'them'));
    r.push(rally(i++, 'us'), rally(i++, 'us'));
    r.push(rally(i++, 'them'), rally(i++, 'us'), rally(i++, 'them'), rally(i++, 'them'));
    r.push(rally(i++)); // untagged: no change
    const s = scoreMatch({ assetId: 'a', analyzedAt: 0, rallies: r });
    expect(s.sets).toEqual([[25, 23], [1, 3]]);
    expect(s.won).toEqual([1, 0]);
    expect(s.rallies[47].after).toEqual([25, 23]);
    expect(s.rallies[48]).toMatchObject({ set: 2, before: [0, 0], after: [0, 1] });
    expect(s.rallies[52].after).toEqual([1, 3]);
  });

  it('extends a tight set past 25 and plays the fifth to 15', () => {
    const r: MatchRally[] = [];
    let i = 0;
    for (let k = 0; k < 26; k++) r.push(rally(i++, 'us'), rally(i++, 'them'));
    expect(scoreMatch({ assetId: 'a', analyzedAt: 0, rallies: r }).sets).toEqual([[26, 26]]);
    r.push(rally(i++, 'us'), rally(i++, 'us'));
    expect(scoreMatch({ assetId: 'a', analyzedAt: 0, rallies: r }).sets[0]).toEqual([28, 26]);
  });

  it('works out the serve, sideouts and our rotation', () => {
    const r = [
      rally(0, 'them', [act('p1', 'pass', '2')]), // they served, won
      rally(1, 'us'), // they served (won last), we sideout: rotation 1 -> 2
      rally(2, 'us', [act('p2', 'serve', 'ace')]), // we serve
      rally(3, 'them'), // we served, they sideout
      rally(4, 'us'), // they served, our sideout: rotation 2 -> 3
    ];
    const s = scoreMatch({ assetId: 'a', analyzedAt: 0, rallies: r, serveFirst: 'them' });
    expect(s.rallies.map((x) => x.serving)).toEqual(['them', 'them', 'us', 'us', 'them']);
    expect(s.rallies.map((x) => x.rotation)).toEqual([1, 1, 2, 2, 2]);
    expect(s.rallies.map((x) => x.sideout)).toEqual([false, true, false, false, true]);
  });
});

describe('volleyball box score', () => {
  const m: MatchData = {
    assetId: 'a',
    analyzedAt: 0,
    serveFirst: 'us',
    rallies: [
      rally(0, 'us', [act('p1', 'serve', 'in'), act('p2', 'dig', 'dig'), act('p3', 'set', 'assist'), act('p1', 'attack', 'kill')]),
      rally(1, 'them', [act('p1', 'serve', 'error')]),
      rally(2, 'us', [act('p2', 'pass', '3'), act('p3', 'set', 'assist'), act('p1', 'attack', 'kill')]),
      rally(3, 'us', [act('p1', 'serve', 'ace')]),
      rally(4, 'them', [act('p1', 'serve', 'in'), act('p1', 'attack', 'blocked')]),
      rally(5, 'us', [act('p2', 'pass', '1'), act('p1', 'attack', 'in'), act(undefined, 'opp', 'error')]),
      rally(6, 'us', [act('p1', 'serve', 'in'), act('p4', 'block', 'assist'), act('p1', 'block', 'assist')]),
    ],
  };
  const st = volleyStats(m);
  it('builds each player line', () => {
    const p1 = st.players.get('p1')!;
    expect(p1).toMatchObject({ kills: 2, attackErrors: 1, attempts: 4, aces: 1, serveErrors: 1, serves: 5, blockAssists: 1 });
    expect(p1.hitting).toBeCloseTo(0.25);
    expect(p1.points).toBe(3.5);
    expect(st.players.get('p2')).toMatchObject({ digs: 1, receptions: 2, passRating: 2 });
    expect(st.players.get('p3')!.assists).toBe(2);
  });
  it('team totals, their errors, sideout and point scoring', () => {
    expect(st.team).toMatchObject({ kills: 2, aces: 1, assists: 2, attempts: 4 });
    expect(st.oppErrors).toBe(1);
    // Served by: us, us, them, us, us, them, us.
    expect(st.pointScoring).toEqual([3, 5]);
    expect(st.sideout).toEqual([2, 2]);
    expect(st.rotations.reduce((s, [w, l]) => s + w + l, 0)).toBe(7);
  });
  it('finds the plays behind a stat', () => {
    expect(ralliesWith(m, (a) => a.player === 'p1' && a.result === 'kill').map((r) => r.id)).toEqual(['r0', 'r2']);
  });
  it('knows which tags end a point', () => {
    expect(pointOf({ skill: 'attack', result: 'kill' })).toBe('us');
    expect(pointOf({ skill: 'serve', result: 'error' })).toBe('them');
    expect(pointOf({ skill: 'dig', result: 'dig' })).toBeUndefined();
    expect(pointOf({ skill: 'opp', result: 'error' })).toBe('us');
  });
  it('prints hitting percentage the volleyball way', () => {
    expect(pct3(0.25)).toBe('.250');
    expect(pct3(-0.1)).toBe('-.100');
    expect(pct3(1)).toBe('1.000');
    expect(pct3(null)).toBe('–');
  });
});

describe('other sports', () => {
  it('counts each player’s plays', () => {
    const c = playCounts({ assetId: 'a', analyzedAt: 0, rallies: [rally(0, 'us', [act('p1', 'Goal', 'done'), act('p2', 'Assist', 'done')]), rally(1, 'us', [act('p1', 'Goal', 'done')])] });
    expect(c.get('p1')!.get('Goal')).toBe(2);
    expect(c.get('p2')!.get('Assist')).toBe(1);
  });
});

describe('the game summary', () => {
  const kills = (p: string, k: number) => Array.from({ length: k }, () => act(p, 'attack', 'kill'));
  const m: MatchData = {
    assetId: 'a',
    analyzedAt: 0,
    us: 'Eagles',
    them: 'Hawks',
    players: [
      { key: 'p1', number: '7', name: 'Ava Smith', position: 'OH' },
      { key: 'p2', number: '#3', name: 'Mia Jones', position: 'S' },
    ],
    rallies: [
      rally(0, 'us', [...kills('p1', 3), ...kills('p2', 1)]),
      rally(1, 'us', [act('p2', 'serve', 'ace'), act('p2', 'set', 'assist')]),
      rally(2, 'them', [act('p1', 'dig', 'dig')]),
    ],
  };

  it('names the top player in each stat, skipping stats nobody recorded', () => {
    const l = gameLeaders(m, true);
    expect(l.map((x) => [x.label, x.value, x.player])).toEqual([
      ['Kills', '3', 'p1'],
      ['Aces', '1', 'p2'],
      ['Digs', '1', 'p1'],
      ['Assists', '1', 'p2'],
    ]);
    expect(gameLeaders(m, false)[0]).toMatchObject({ label: 'attack', value: '3', player: 'p1' });
  });

  it('reads a partly tagged first set as points, and finished sets as sets won', () => {
    expect(finalScore(scoreMatch(m), true)).toEqual({ us: 2, them: 1, sets: [], partial: true });
    const sets = finalScore({ rallies: [], sets: [[25, 20], [22, 25], [25, 18], [0, 0]], won: [2, 1] }, true);
    expect(sets).toEqual({ us: 2, them: 1, sets: [[25, 20], [22, 25], [25, 18]], partial: false });
    expect(finalScore({ rallies: [], sets: [[3, 1]], won: [0, 0] }, false)).toEqual({ us: 3, them: 1, sets: [], partial: false });
  });

  it('builds the summary graphic with the leaders and the result', () => {
    const g = summarySpec(m, true, BLANK, {});
    expect(g.type).toBe('summary');
    expect(g.text).toMatchObject({ usName: 'Eagles', themName: 'Hawks', usScore: '2', themScore: '1', result: '', kicker: 'Game summary' });
    expect(g.rows?.[0]).toEqual(['Kills', '3']);
    expect(g.players?.[0]).toEqual({ number: '7', name: 'Ava Smith' });
    expect(g.players?.[1]).toEqual({ number: '3', name: 'Mia Jones' });
    expect(g.text.footer).toMatch(/Hitting 1\.000 .* 1 ace .* 1 dig/);
  });
});
