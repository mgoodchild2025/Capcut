import { describe, expect, it } from 'vitest';
import { getMainTrack, trackClips } from '../model/ops';
import type { Asset, Project } from '../model/types';
import { punches, whenParts } from './league';
import { buildReel, type ReelInfo, type ReelInput, type ReelStyle } from './reel';

const asset = (id: string, kind: Asset['kind'], duration: number, extra: Partial<Asset> = {}): Asset => ({
  id, name: id, kind, url: '', duration, width: kind === 'audio' ? 0 : 1920, height: kind === 'audio' ? 0 : 1080, size: 0, hasAudio: kind !== 'image', ...extra,
});
// 120 BPM: a beat is half a second, a bar two.
const assets: Record<string, Asset> = {
  g1: asset('g1', 'video', 60),
  g2: asset('g2', 'video', 60),
  g3: asset('g3', 'video', 60),
  music: asset('music', 'audio', 120, { bpm: 120, beats: Array.from({ length: 240 }, (_, i) => i * 0.5) }),
  whoosh: asset('whoosh', 'audio', 0.9),
  impact: asset('impact', 'audio', 2),
  logo: asset('logo', 'image', Infinity, { width: 400, height: 400 }),
  rLogo: asset('rLogo', 'image', Infinity, { width: 400, height: 400 }),
};
const info: ReelInfo = {
  name: 'Metro Volleyball League', number: '', position: '', gradYear: '', height: '', club: '', school: '', email: '', phone: '', season: '2026', record: '',
  colors: ['#0b1d51', '#f5b700'], stats: [], headline: '', opponent: '', roster: [], sets: [],
  league: {
    tagline: 'Every point. Every night. One champion.',
    when: 'Sat Jan 10 · 7 PM',
    where: 'Metro Arena · Live on YouTube',
    url: 'metrovl.ca',
    sponsor: 'Acme Sports',
    teams: [
      { key: 'r', name: 'Rockets', colors: ['#1d4ed8', '#fbbf24'], record: '8-2' },
      { key: 's', name: 'Storm', colors: ['#b91c1c', '#f8fafc'], record: '7-3' },
      { key: 'b', name: 'Blaze', colors: ['#ea580c', '#18181b'] },
      { key: 'h', name: 'Hawks', colors: ['#15803d', '#f0fdf4'] },
      { key: 'w', name: 'Waves', colors: ['#0369a1', '#e0f2fe'] },
    ],
    home: 'r',
    away: 's',
    divisions: 'U14 · U16 · U18 · Open',
    deadline: 'Dec 15',
    fee: '$250 per player',
  },
};
const input = (style: ReelStyle, over: Partial<ReelInput> = {}): ReelInput => ({
  style,
  info,
  clips: [
    { assetId: 'g1', inPoint: 5, duration: 8 },
    { assetId: 'g2', inPoint: 10, duration: 8 },
    { assetId: 'g3', inPoint: 2, duration: 8 },
    { assetId: 'g1', inPoint: 30, duration: 6 },
  ],
  cards: { music: 'music', whoosh: 'whoosh', impact: 'impact', logo: 'logo', teamLogos: { r: 'rLogo' } },
  ...over,
});
const main = (p: Project) => trackClips(p, getMainTrack(p).id);
const types = (p: Project) => main(p).map((c) => c.graphic?.type ?? 'play');
const graphic = (p: Project, type: string) => p.clips.find((c) => c.graphic?.type === type);

describe('league promos', () => {
  it('cuts a season launch: cold open, teams, the slogan, the date, the sign-off', () => {
    const p = buildReel(input('season'), assets);
    expect([p.settings.width, p.settings.height]).toEqual([1920, 1080]);
    const t = types(p);
    expect(t.slice(0, 3)).toEqual(['play', 'play', 'logoWall']);
    expect(t.slice(-2)).toEqual(['dateSlate', 'endSlate']);
    // Every cut lands on a beat.
    for (const c of main(p)) expect((c.start / 0.5) % 1).toBeCloseTo(0, 5);
    // The cold open is slowed and behind cinema bars, with its words.
    expect(main(p)[0].curve?.id).toBe('hero');
    expect(graphic(p, 'letterbox')!.duration).toBeCloseTo(main(p)[2].start, 5);
    const kinetic = p.clips.filter((c) => c.graphic?.type === 'kinetic').map((c) => c.graphic!.text.lines);
    expect(kinetic).toEqual(['The wait|is over', 'Every point.', 'Every night.', 'One champion.']);
    // Teams with their logos (or colours), the league over them.
    const wall = graphic(p, 'logoWall')!.graphic!;
    expect(wall.teams!.map((x) => x.name)).toEqual(['Rockets', 'Storm', 'Blaze', 'Hawks', 'Waves']);
    expect(wall.teams![0].logo).toBe('rLogo');
    expect(wall.teams![1].logo).toBeUndefined();
    expect(wall.text.title).toBe('5 TEAMS. ONE CROWN.');
    expect(graphic(p, 'dateSlate')!.graphic!.text).toMatchObject({ kicker: 'SEASON TIPS OFF', title: 'SAT JAN 10', sub: '7 PM', where: 'Metro Arena · Live on YouTube' });
    expect(graphic(p, 'endSlate')!.graphic!.text).toMatchObject({ title: 'METRO VOLLEYBALL LEAGUE', url: 'metrovl.ca', sponsor: 'Acme Sports' });
    expect(graphic(p, 'endSlate')!.graphic!.logo).toBe('logo');
    // Music under it all, glitch hits on the slogan's cuts.
    expect(p.clips.some((c) => c.assetId === 'music')).toBe(true);
    expect(p.clips.filter((c) => c.graphic?.type === 'glitch').length).toBe(3);
    expect(p.name).toBe('Metro Volleyball League Season launch');
  });

  it('bills game night away at home, in their colours', () => {
    const p = buildReel(input('gamenight'), assets);
    const vs = graphic(p, 'versus')!.graphic!;
    expect(vs.text).toMatchObject({ usName: 'STORM', themName: 'ROCKETS', usSub: '7-3', themSub: '8-2', kicker: 'GAME NIGHT' });
    expect(vs.colors).toEqual(['#b91c1c', '#f8fafc']);
    expect(vs.oppColors).toEqual(['#1d4ed8', '#fbbf24']);
    expect(vs.oppLogo).toBe('rLogo');
    expect(p.poster).toBeGreaterThan(graphic(p, 'versus')!.start);
  });

  it('draws the playoff bracket with the seeds in order', () => {
    const p = buildReel(input('playoffs'), assets);
    const b = graphic(p, 'bracket')!.graphic!;
    expect(b.text.title).toBe('2026 PLAYOFFS');
    expect(b.teams!.length).toBe(5);
    expect(types(p)).toContain('dateSlate');
    expect(graphic(p, 'dateSlate')!.graphic!.text.kicker).toBe('PLAYOFFS BEGIN');
  });

  it('ends registration on the sign-up card with what, when, how much and a link', () => {
    const p = buildReel(input('signup'), assets);
    const s = graphic(p, 'signup')!.graphic!;
    expect(s.rows).toEqual([
      ['Divisions', 'U14 · U16 · U18 · Open'],
      ['Season', 'Sat Jan 10 · 7 PM'],
      ['Fee', '$250 per player'],
      ['Register by', 'Dec 15'],
    ]);
    expect(s.text.url).toBe('metrovl.ca');
    expect(types(p).slice(-2)).toEqual(['signup', 'endSlate']);
  });

  it('works without footage: the words carry it, full screen', () => {
    const p = buildReel(input('season', { clips: [] }), assets);
    expect(types(p)[0]).toBe('kinetic');
    expect(main(p).every((c) => c.kind === 'graphic')).toBe(true);
    expect(main(p).filter((c) => c.graphic?.type === 'kinetic').every((c) => c.graphic!.text.bg === '1')).toBe(true);
  });

  it('comes in a tall cut for Stories and Reels', () => {
    const p = buildReel(input('season', { info: { ...info, format: 'social' } }), assets);
    expect([p.settings.width, p.settings.height]).toEqual([1080, 1920]);
    expect(main(p).filter((c) => c.kind === 'video').every((c) => c.fit === 'cover')).toBe(true);
  });

  it('reads the slogan and the date in parts', () => {
    expect(punches('Every point. Every night. One champion.')).toEqual(['Every point.', 'Every night.', 'One champion.']);
    expect(punches('Win or go home')).toEqual(['Win or go home']);
    expect(punches('Rise · Fight · Win')).toEqual(['Rise', 'Fight', 'Win']);
    expect(whenParts('Fri Mar 6 · 7:30 PM · Metro Arena')).toEqual({ title: 'Fri Mar 6', sub: '7:30 PM  ·  Metro Arena' });
  });

  it("boards this week's games, each with its teams, time and place", () => {
    const games = [
      { key: 'g1', away: 's', home: 'r', when: 'Fri 7 PM', where: 'Court 1' },
      { key: 'g2', away: 'b', home: 'h', when: 'Sat 6 PM', where: '' },
      { key: 'g3', away: 'w', home: 'gone', when: 'Sun', where: '' },
    ];
    const p = buildReel(input('schedule', { info: { ...info, league: { ...info.league!, games } } }), assets);
    const f = graphic(p, 'fixtures')!.graphic!;
    expect(f.teams!.map((t) => t.name)).toEqual(['Storm', 'Rockets', 'Blaze', 'Hawks']);
    expect(f.rows).toEqual([
      ['Fri 7 PM', 'Court 1'],
      ['Sat 6 PM', ''],
    ]);
    expect(f.teams![1].logo).toBe('rLogo');
    expect(types(p)).not.toContain('dateSlate');
    expect(types(p).slice(-1)).toEqual(['endSlate']);
  });

  it('builds the standings in table order with records and points', () => {
    const teams = info.league!.teams.map((t, i) => ({ ...t, record: `${9 - i}-${1 + i}`, points: String(27 - i * 3) }));
    const p = buildReel(input('standings', { info: { ...info, league: { ...info.league!, teams } } }), assets);
    const st = graphic(p, 'standings')!.graphic!;
    expect(st.text.title).toBe('2026 STANDINGS');
    expect(st.rows![0]).toEqual(['9-1', '27']);
    expect(st.teams!.length).toBe(5);
    expect(graphic(p, 'dateSlate')!.graphic!.text.kicker).toBe('NEXT UP');
  });

  it('announces a tournament: the event card, then entering a team', () => {
    const p = buildReel(input('tournament', { info: { ...info, name: 'Spring Showdown', league: { ...info.league!, when: 'May 16-17', where: 'Metro Sports Complex', prize: '$2,000 prize pool', fee: '$400 per team' } } }), assets);
    const e = graphic(p, 'eventCard')!.graphic!;
    expect(e.text).toMatchObject({ title: 'SPRING SHOWDOWN', kicker: '2026', when: 'May 16-17', where: 'Metro Sports Complex', prize: '$2,000 prize pool', divisions: 'U14 · U16 · U18 · Open' });
    const s2 = graphic(p, 'signup')!.graphic!;
    expect(s2.text.title).toBe('ENTER YOUR TEAM');
    expect(s2.rows!.map(([k]) => k)).toEqual(['Divisions', 'Dates', 'Fee', 'Register by']);
    expect(types(p).slice(-2)).toEqual(['signup', 'endSlate']);
    expect(p.poster).toBeGreaterThan(graphic(p, 'eventCard')!.start);
  });

  it('bills the championship final between the two finalists', () => {
    const p = buildReel(input('final', { info: { ...info, league: { ...info.league!, prize: 'The Cup' } } }), assets);
    const vs = graphic(p, 'versus')!.graphic!;
    expect(vs.text).toMatchObject({ kicker: 'THE FINAL', usName: 'STORM', themName: 'ROCKETS' });
    expect(vs.text.sub).toContain('The Cup');
    expect(graphic(p, 'dateSlate')!.graphic!.text.kicker).toBe('CHAMPIONSHIP FINAL');
  });

  it('crowns the champions: victory, podium, MVP, sign-off', () => {
    const p = buildReel(input('champions', { info: { ...info, league: { ...info.league!, score: '3-1', mvp: 'Jordan Lee' } } }), assets);
    const v = graphic(p, 'victory')!.graphic!;
    expect(v.text).toMatchObject({ title: 'CHAMPIONS', score: '3-1', sub: 'ROCKETS' });
    expect(v.colors).toEqual(['#1d4ed8', '#fbbf24']);
    expect(v.logo).toBe('rLogo');
    expect(graphic(p, 'podium')!.graphic!.teams!.map((t) => t.name)).toEqual(['Rockets', 'Storm', 'Blaze']);
    expect(p.clips.some((c) => c.graphic?.type === 'kinetic' && c.graphic.text.lines === 'MVP|Jordan Lee')).toBe(true);
    const t = types(p);
    expect(t.indexOf('victory')).toBeLessThan(t.indexOf('podium'));
    expect(t.slice(-1)).toEqual(['endSlate']);
    expect(t).not.toContain('dateSlate');
  });
});
