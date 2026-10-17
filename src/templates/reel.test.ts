import { describe, expect, it } from 'vitest';
import { getMainTrack, trackClips } from '../model/ops';
import type { Asset, Clip, GraphicType, Project } from '../model/types';
import { buildReel, type ReelInfo, type ReelInput, type ReelStyle } from './reel';

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
  game1: asset('game1', 'video', 120),
  game2: asset('game2', 'video', 60),
  music: asset('music', 'audio', 90, { bpm: 120, beats: Array.from({ length: 180 }, (_, i) => i * 0.5) }),
  whoosh: asset('whoosh', 'audio', 0.9),
  impact: asset('impact', 'audio', 2),
  logo: asset('logo', 'image', Infinity, { width: 400, height: 400 }),
  opp: asset('opp', 'image', Infinity, { width: 400, height: 400 }),
  photo: asset('photo', 'image', Infinity, { width: 1080, height: 1350 }),
  cut: asset('cut', 'image', Infinity, { width: 700, height: 1000 }),
  pclip: asset('pclip', 'video', 2.5, { width: 720, height: 960 }),
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
    { key: 'r1', number: '12', name: 'Jordan Lee', position: 'Outside Hitter', starter: true },
    { key: 'r2', number: '4', name: 'Sam Rivera', position: 'Setter', starter: true },
    { key: 'r3', number: '9', name: 'Ava Chen', position: 'Libero', starter: false },
    { key: 'r4', number: '7', name: 'Mia Ortiz', position: 'Middle Blocker', starter: true },
  ],
  sets: [
    ['25', '21'],
    ['23', '25'],
    ['25', '19'],
  ],
};

const input = (style: ReelStyle, over: Partial<ReelInput> = {}): ReelInput => ({
  style,
  info,
  clips: [
    { assetId: 'game1', inPoint: 30, duration: 7, tag: 'Kill', spotlight: { x: 0.3, y: 0.55 }, player: 'r1', score: '18-21', set: 2 },
    { assetId: 'game2', inPoint: 10, duration: 6, tag: 'Block', player: 'r2' },
    { assetId: 'game1', inPoint: 80, duration: 8 },
  ],
  cards: { music: 'music', whoosh: 'whoosh', impact: 'impact', logo: 'logo', oppLogo: 'opp', photo: 'photo', players: { r1: 'cut', r2: 'pclip' }, cutouts: ['cut'] },
  ...over,
});

const main = (p: Project) => trackClips(p, getMainTrack(p).id);
const graphics = (p: Project, type: GraphicType) => p.clips.filter((c) => c.graphic?.type === type);
const types = (p: Project) => main(p).map((c) => c.graphic?.type ?? c.assetId);

function contiguous(p: Project) {
  const m = main(p);
  for (let i = 1; i < m.length; i++) expect(m[i].start).toBeCloseTo(m[i - 1].start + m[i - 1].duration, 6);
  return m;
}

describe('broadcast reels', () => {
  it('builds a recruiting reel: open, player card, plays, stats, final, closer', () => {
    const p = buildReel(input('recruiting'), assets);
    expect(p.settings.width).toBe(1920);
    contiguous(p);
    expect(types(p)).toEqual(['open', 'playerCard', 'game1', 'game2', 'game1', 'stats', 'final', 'closer']);
    const open = main(p)[0].graphic!;
    expect(open.text).toMatchObject({ kicker: '#12 · OUTSIDE HITTER', title: 'JORDAN LEE' });
    expect(open.logo).toBe('logo');
    // Profile card shows the photo.
    const card = main(p)[1];
    expect(card.assetId).toBe('photo');
    expect(card.graphic).toMatchObject({ media: 'image', cutout: false, text: { number: '12', first: 'Jordan', last: 'Lee' } });
    // Spotted play freezes and rings the player.
    expect(main(p)[2].hold).toBe(1.5);
    expect(main(p)[2].spotlight).toMatchObject({ x: 0.3, label: '#12' });
    // A player-ID lower third on every play, after the freeze.
    const lts = graphics(p, 'lowerThird');
    expect(lts.length).toBe(3);
    expect(lts[0].graphic!.text).toMatchObject({ number: '12', name: 'Jordan Lee', tag: 'Kill' });
    expect(lts[0].start).toBeGreaterThan(main(p)[2].start + 1.5);
    // Score bug only on the scored play, spanning it.
    const bugs = graphics(p, 'scoreBug');
    expect(bugs.length).toBe(1);
    expect(bugs[0].graphic!.text).toMatchObject({ us: '18', them: '21', set: '2', usName: 'ROCKETS 17' });
    expect(bugs[0].start).toBeCloseTo(main(p)[2].start);
    expect(bugs[0].duration).toBeCloseTo(main(p)[2].duration);
    expect(bugs[0].graphic!.oppLogo).toBe('opp');
    const fin = graphics(p, 'final')[0].graphic!;
    expect(fin.sets).toEqual([
      [25, 21],
      [23, 25],
      [25, 19],
    ]);
    expect(fin.text.result).toBe('ROCKETS 17 ELITE win 2-1');
    expect(graphics(p, 'closer')[0].graphic!.text.sub).toMatch(/jordan@example.com/);
  });

  it('covers section changes with stingers on their own top track', () => {
    const p = buildReel(input('recruiting'), assets);
    const st = graphics(p, 'stinger');
    // Into the card, into the plays, into stats, into final, into the closer.
    expect(st.length).toBe(5);
    const cuts = main(p).map((c) => c.start);
    for (const s of st) expect(cuts.some((t) => Math.abs(t - (s.start + s.duration / 2)) < 1e-6)).toBe(true);
    const track = p.tracks.find((t) => t.id === st[0].trackId)!;
    expect(st.every((s) => s.trackId === track.id)).toBe(true);
    // Topmost video track, so it covers the lower thirds and score bug.
    const videoTracks = p.tracks.filter((t) => t.kind === 'video');
    expect(videoTracks[0].id).toBe(track.id);
  });

  it('builds a beat-locked vertical hype reel with slow motion', () => {
    const p = buildReel(input('hype'), assets);
    expect(p.settings.height).toBe(1920);
    const m = contiguous(p);
    for (const c of m) expect(Math.abs(c.start / 2 - Math.round(c.start / 2))).toBeLessThan(1e-6);
    expect(m.some((c) => c.curve?.id === 'hero')).toBe(true);
    const spot = m.find((c) => c.spotlight)!;
    expect(spot.fit).toBe('cover');
    expect(spot.transform.x).toBeGreaterThan(0);
  });

  it('builds a 4:5 spotlight with the headline and a cut-out player card', () => {
    const p = buildReel(input('spotlight', { cards: { ...input('spotlight').cards, photo: 'cut' } }), assets);
    expect([p.settings.width, p.settings.height]).toEqual([1080, 1350]);
    const m = contiguous(p);
    expect(m[0].graphic!.text.kicker).toBe('PLAYER OF THE GAME');
    expect(m[1].graphic).toMatchObject({ type: 'playerCard', cutout: true });
    expect(graphics(p, 'stats')[0].graphic!.text.title).toBe('By the numbers');
  });

  it('builds a team reel with a roster wall and plays credited to players', () => {
    const p = buildReel(input('team', { info: { ...info, name: 'Rockets' } }), assets);
    const m = contiguous(p);
    expect(types(p).slice(0, 2)).toEqual(['open', 'roster']);
    const wall = m[1].graphic!;
    expect(wall.players!.map((x) => x.number)).toEqual(['12', '4', '9', '7']);
    // Only photos (not clips) go on the wall.
    expect(wall.players![0].photo).toBe('cut');
    expect(wall.players![1].photo).toBeUndefined();
    const lts = graphics(p, 'lowerThird').map((c) => c.graphic!.text);
    expect(lts[0]).toMatchObject({ number: '12', name: 'Jordan Lee', detail: 'Outside Hitter', tag: 'Kill' });
    expect(lts[1]).toMatchObject({ number: '4', name: 'Sam Rivera', tag: 'Block' });
    expect(lts.length).toBe(2);
    expect(graphics(p, 'closer')[0].graphic!.text).toMatchObject({ kicker: 'WE ARE', title: 'ROCKETS' });
    for (const c of m) expect(Math.abs(c.start / 2 - Math.round(c.start / 2))).toBeLessThan(1e-6);
  });

  it('builds a starting lineup: versus open, a card per starter with their media, then the send-off', () => {
    const p = buildReel(input('lineup', { info: { ...info, name: 'Rockets' }, clips: [] }), assets);
    const m = contiguous(p);
    expect(types(p)).toEqual(['open', 'playerCard', 'playerCard', 'playerCard', 'closer']);
    expect(m[0].graphic).toMatchObject({ logo: 'logo', oppLogo: 'opp', text: { title: 'STARTING LINEUP', sub: 'ROCKETS  vs WESTSIDE STORM' } });
    const [a, b, c] = m.slice(1, 4);
    expect(a).toMatchObject({ assetId: 'cut', graphic: { cutout: true, media: 'image', text: { number: '12', last: 'Lee', count: '1/3' } } });
    expect(b).toMatchObject({ assetId: 'pclip', graphic: { media: 'video', text: { number: '4', count: '2/3' } } });
    expect(c.assetId).toBeUndefined();
    expect(c.graphic!.text).toMatchObject({ number: '7', last: 'Ortiz', position: 'Middle Blocker' });
    expect(m[4].graphic!.text).toMatchObject({ kicker: "LET'S GO", title: 'ROCKETS!' });
    for (const x of m) expect(Math.abs(x.start / 2 - Math.round(x.start / 2))).toBeLessThan(1e-6);
    expect(graphics(p, 'scoreBug').length).toBe(0);
  });

  it('keeps every overlay inside the reel and the music the length of the reel', () => {
    for (const style of ['recruiting', 'hype', 'recap', 'spotlight', 'team', 'lineup'] as const) {
      const p = buildReel(input(style), assets);
      const end = Math.max(...main(p).map((c) => c.start + c.duration));
      for (const c of p.clips.filter((x: Clip) => x.kind === 'graphic')) {
        expect(c.duration).toBeGreaterThan(0);
        expect(c.start).toBeGreaterThanOrEqual(0);
        expect(c.start + c.duration).toBeLessThanOrEqual(end + 1e-6);
      }
      const music = p.clips.find((c) => c.assetId === 'music')!;
      expect(music.duration).toBeCloseTo(Math.min(90, end));
    }
  });

  it('works without logos, photos, stats or scores', () => {
    const bare: ReelInput = { style: 'recruiting', info: { ...info, stats: [], sets: [], opponent: '' }, clips: [{ assetId: 'game2', inPoint: 0, duration: 5 }], cards: {} };
    const p = buildReel(bare, assets);
    expect(types(p)).toEqual(['open', 'playerCard', 'game2', 'closer']);
    expect(main(p)[1].assetId).toBeUndefined();
    expect(graphics(p, 'scoreBug').length).toBe(0);
  });
});
