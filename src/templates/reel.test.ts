import { describe, expect, it } from 'vitest';
import { getMainTrack, trackClips } from '../model/ops';
import type { Asset } from '../model/types';
import { buildReel, type ReelInfo, type ReelInput } from './reel';

const asset = (id: string, kind: Asset['kind'], duration: number, extra: Partial<Asset> = {}): Asset => ({
  id,
  name: id,
  kind,
  url: '',
  duration,
  width: kind === 'audio' ? 0 : 1920,
  height: kind === 'audio' ? 0 : 1080,
  size: 0,
  hasAudio: kind !== 'image',
  ...extra,
});

const assets: Record<string, Asset> = {
  intro: asset('intro', 'image', Infinity),
  info: asset('info', 'image', Infinity),
  stats: asset('stats', 'image', Infinity),
  outro: asset('outro', 'image', Infinity),
  game1: asset('game1', 'video', 120),
  game2: asset('game2', 'video', 60),
  music: asset('music', 'audio', 60, { bpm: 120, beats: Array.from({ length: 120 }, (_, i) => i * 0.5) }),
  whoosh: asset('whoosh', 'audio', 0.9),
  impact: asset('impact', 'audio', 2),
  roster: asset('roster', 'image', Infinity),
  photo: asset('photo', 'image', Infinity, { width: 1080, height: 1350 }),
  n4: asset('n4', 'image', Infinity),
  self: asset('self', 'image', Infinity),
  logo: asset('logo', 'image', Infinity, { width: 400, height: 200 }),
  final: asset('final', 'image', Infinity),
};

const info: ReelInfo = {
  name: 'Jordan Lee',
  number: '12',
  position: 'Outside Hitter',
  gradYear: '2027',
  height: `6'1"`,
  club: 'Rockets 17 Elite',
  school: 'Lincoln High',
  email: 'jordan@example.com',
  phone: '555-0100',
  season: '2026',
  record: '24-6',
  colors: ['#1d4ed8', '#fbbf24'],
  stats: [
    ['Kills', '245'],
    ['Aces', '41'],
  ],
  headline: 'Player of the Game',
  opponent: 'Westside Storm',
  roster: [
    { key: 'r1', number: '12', name: 'Jordan Lee', position: 'Outside Hitter', starter: true, assetId: 'photo' },
    { key: 'r2', number: '4', name: 'Sam Rivera', position: 'Setter', starter: true },
    { key: 'r3', number: '9', name: 'Ava Chen', position: 'Libero', starter: false },
    { key: 'r4', number: '7', name: 'Mia Ortiz', position: 'Middle Blocker', starter: true, assetId: 'game2' },
  ],
  sets: [],
  badge: true,
};

const input = (style: ReelInput['style']): ReelInput => ({
  style,
  info,
  clips: [
    { assetId: 'game1', inPoint: 30, duration: 7, tag: 'Kill', spotlight: { x: 0.3, y: 0.55 } },
    { assetId: 'game2', inPoint: 10, duration: 6, tag: 'Block' },
    { assetId: 'game1', inPoint: 80, duration: 8 },
  ],
  cards: { intro: 'intro', info: 'info', stats: 'stats', outro: 'outro', music: 'music', whoosh: 'whoosh', impact: 'impact', roster: 'roster', players: { r2: 'n4', self: 'self' } },
});

const texts = (p: ReturnType<typeof buildReel>) => p.clips.filter((c) => c.kind === 'text').map((c) => c.text!.content);
const contiguous = (p: ReturnType<typeof buildReel>) => {
  const main = trackClips(p, getMainTrack(p).id);
  for (let i = 1; i < main.length; i++) expect(main[i].start).toBeCloseTo(main[i - 1].start + main[i - 1].duration, 6);
  return main;
};

describe('highlight reel builder', () => {
  it('builds a recruiting reel: intro, profile, clips, stats, outro', () => {
    const p = buildReel(input('recruiting'), assets);
    expect(p.settings.width).toBe(1920);
    const main = trackClips(p, getMainTrack(p).id);
    expect(main.map((c) => c.assetId)).toEqual(['intro', 'info', 'game1', 'game2', 'game1', 'stats', 'outro']);
    // Contiguous main track.
    for (let i = 1; i < main.length; i++) expect(main[i].start).toBeCloseTo(main[i - 1].start + main[i - 1].duration, 6);
    const spot = main[2];
    expect(spot.hold).toBe(1.5);
    expect(spot.spotlight).toMatchObject({ x: 0.3, y: 0.55, label: '#12', color: '#fbbf24' });
    expect(spot.inPoint).toBe(30);
    const texts = p.clips.filter((c) => c.kind === 'text').map((c) => c.text!.content);
    expect(texts).toContain('JORDAN LEE');
    expect(texts.some((t) => /KILL/.test(t))).toBe(true);
    expect(texts.some((t) => /245\s+KILLS/.test(t))).toBe(true);
    expect(texts.some((t) => /jordan@example.com/.test(t))).toBe(true);
    const music = p.clips.find((c) => c.assetId === 'music')!;
    const end = Math.max(...main.map((c) => c.start + c.duration));
    expect(music.duration).toBeCloseTo(Math.min(60, end));
    expect(music.volume).toBeLessThan(0.5);
  });

  it('keeps every text overlay inside the reel', () => {
    for (const style of ['recruiting', 'hype', 'recap', 'spotlight', 'team', 'lineup'] as const) {
      const p = buildReel(input(style), assets);
      const end = Math.max(...p.clips.filter((c) => c.kind !== 'audio').map((c) => c.start + c.duration));
      for (const c of p.clips.filter((x) => x.kind === 'text')) {
        expect(c.duration).toBeGreaterThan(0);
        expect(c.start + c.duration).toBeLessThanOrEqual(end + 1e-6);
      }
    }
  });

  it('builds a vertical, beat-locked hype reel', () => {
    const p = buildReel(input('hype'), assets);
    expect(p.settings.height).toBe(1920);
    const main = trackClips(p, getMainTrack(p).id);
    for (const c of main) expect(Math.abs(c.start / 2 - Math.round(c.start / 2))).toBeLessThan(1e-6);
    const hero = main.find((c) => c.curve?.id === 'hero');
    expect(hero).toBeTruthy();
    // Landscape footage fills the vertical frame, reframed towards the spotlighted player.
    const spot = main.find((c) => c.spotlight)!;
    expect(spot.fit).toBe('cover');
    expect(spot.transform.x).toBeGreaterThan(0);
    expect(p.clips.filter((c) => c.assetId === 'whoosh').length).toBe(main.length - 1);
    expect(main.some((c) => c.transition === 'flash')).toBe(true);
  });

  it('builds a team season recap without player-only cards', () => {
    const p = buildReel({ ...input('recap'), info: { ...info, name: 'Rockets' } }, assets);
    const main = trackClips(p, getMainTrack(p).id);
    expect(main.map((c) => c.assetId)).not.toContain('info');
    expect(main.every((c) => !c.spotlight)).toBe(true);
    const texts = p.clips.filter((c) => c.kind === 'text').map((c) => c.text!.content);
    expect(texts).toContain('SEASON 2026');
    expect(texts).toContain('GO ROCKETS!');
  });

  it('builds a 4:5 player spotlight that rings the player in every spotted play', () => {
    const p = buildReel(input('spotlight'), assets);
    expect([p.settings.width, p.settings.height]).toEqual([1080, 1350]);
    const main = contiguous(p);
    expect(main[0].assetId).toBe('self');
    expect(main[main.length - 1].assetId).toBe('self');
    const spot = main.find((c) => c.spotlight)!;
    expect(spot.hold).toBe(1.2);
    expect(spot.fit).toBe('cover');
    const t = texts(p);
    expect(t).toContain('PLAYER OF THE GAME');
    expect(t).toContain('BY THE NUMBERS');
    // A name tag on each of the three plays.
    expect(t.filter((x) => x === '#12 JORDAN LEE').length).toBe(3);
    expect(t.some((x) => /jordan@example.com/.test(x))).toBe(false);
  });

  it('builds a team reel with a roster card and plays credited to players', () => {
    const clips = input('team').clips.map((c, i) => ({ ...c, player: ['r1', 'r2', undefined][i] }));
    const p = buildReel({ ...input('team'), clips, info: { ...info, name: 'Rockets' } }, assets);
    expect(p.settings.height).toBe(1920);
    const main = contiguous(p);
    expect(main.map((c) => c.assetId)).toEqual(['intro', 'roster', 'game1', 'game2', 'game1', 'stats', 'outro']);
    for (const c of main) expect(Math.abs(c.start / 2 - Math.round(c.start / 2))).toBeLessThan(1e-6);
    const t = texts(p);
    expect(t).toContain('THE SQUAD');
    expect(t.some((x) => /#12\s+JORDAN LEE/.test(x) && /#4\s+SAM RIVERA/.test(x))).toBe(true);
    expect(t).toContain('#12 JORDAN LEE  ·  KILL');
    expect(t).toContain('#4 SAM RIVERA  ·  BLOCK');
    expect(t).toContain('WE ARE');
    expect(main.filter((c) => c.kind === 'video').every((c) => c.fit === 'cover')).toBe(true);
  });

  it('builds a starting lineup with one reveal per starter', () => {
    const p = buildReel({ ...input('lineup'), clips: [], info: { ...info, name: 'Rockets' } }, assets);
    const main = contiguous(p);
    // Intro, three starters (the libero is on the bench), outro.
    expect(main.map((c) => c.assetId)).toEqual(['intro', 'photo', 'n4', 'game2', 'outro']);
    for (const c of main) expect(Math.abs(c.start / 2 - Math.round(c.start / 2))).toBeLessThan(1e-6);
    // Photos get a slow push-in; video plays muted.
    expect(main[1].keyframes?.scale?.map((k) => k.v)).toEqual([1, 1.12]);
    expect(main[3].volume).toBe(0);
    const t = texts(p);
    expect(t).toContain('STARTING\nLINEUP');
    expect(t).toContain('ROCKETS\nVS WESTSIDE STORM');
    expect(t).toContain('JORDAN\nLEE');
    expect(t).toContain('#4');
    expect(t).toContain('SETTER');
    expect(t.some((x) => /AVA/.test(x))).toBe(false);
    expect(t).toContain('ROCKETS!');
    expect(p.clips.filter((c) => c.assetId === 'whoosh').length).toBe(main.length - 1);
  });

  it('puts the team logo on title cards and a corner badge across the plays', () => {
    for (const style of ['recruiting', 'hype', 'spotlight', 'team', 'lineup', 'recap'] as const) {
      const base = input(style);
      const p = buildReel({ ...base, cards: { ...base.cards, logo: 'logo' } }, assets);
      const logos = p.clips.filter((c) => c.assetId === 'logo');
      const main = trackClips(p, getMainTrack(p).id);
      const titles = main.filter((c) => ['intro', 'outro', 'roster', 'self', 'n4'].includes(c.assetId!));
      // One per title card plus one badge.
      expect(logos.length).toBe(titles.length + 1);
      const W = p.settings.width;
      const H = p.settings.height;
      for (const l of logos) {
        // Fully inside the frame.
        const fit = Math.min(W / 400, H / 200);
        const w = 400 * fit * l.transform.scale;
        const h = 200 * fit * l.transform.scale;
        const cx = W / 2 + l.transform.x * W;
        const cy = H / 2 + l.transform.y * H;
        expect(cx - w / 2).toBeGreaterThan(0);
        expect(cx + w / 2).toBeLessThan(W);
        expect(cy - h / 2).toBeGreaterThan(0);
        expect(l.trackId).not.toBe(getMainTrack(p).id);
      }
      const badge = logos.reduce((a, b) => (a.duration > b.duration ? a : b));
      expect(badge.transform.opacity).toBe(0.9);
    }
  });

  it('leaves the badge off when asked', () => {
    const base = input('hype');
    const p = buildReel({ ...base, info: { ...info, badge: false }, cards: { ...base.cards, logo: 'logo' } }, assets);
    expect(p.clips.filter((c) => c.assetId === 'logo').length).toBe(2);
  });

  it('adds score bugs to scored plays and a final score card', () => {
    const base = input('recruiting');
    const clips = base.clips.map((c, i) => ({ ...c, score: ['18-21', '', '25–23'][i] || undefined, set: [2, undefined, 3][i] }));
    const p = buildReel({ ...base, clips, info: { ...info, opponent: 'Westside Storm', sets: [['25', '21'], ['23', '25'], ['25', '19'], ['', '']] }, cards: { ...base.cards, final: 'final' } }, assets);
    const t = texts(p);
    expect(t).toContain('S2   ROCKETS 17  18–21  WESTSIDE');
    expect(t).toContain('S3   ROCKETS 17  25–23  WESTSIDE');
    expect(t.filter((x) => /–/.test(x) && /^S\d/.test(x)).length).toBe(2);
    const main = contiguous(p);
    const ids = main.map((c) => c.assetId);
    expect(ids.indexOf('final')).toBe(ids.length - 2);
    expect(t).toContain('FINAL');
    expect(t).toContain('2 – 1');
    expect(t).toContain('ROCKETS 17 ELITE WIN\nvs WESTSIDE STORM');
    expect(t).toContain('25–21   23–25   25–19');
    // Each bug spans exactly its play.
    const bug = p.clips.find((c) => c.text?.content.startsWith('S2'))!;
    const play = main[2];
    expect(bug.start).toBeCloseTo(play.start);
    expect(bug.duration).toBeCloseTo(play.duration);
  });

  it('skips the final card without set scores', () => {
    const base = input('team');
    const p = buildReel({ ...base, cards: { ...base.cards, final: 'final' } }, assets);
    expect(trackClips(p, getMainTrack(p).id).some((c) => c.assetId === 'final')).toBe(false);
  });
});
