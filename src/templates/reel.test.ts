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
};

const input = (style: ReelInput['style']): ReelInput => ({
  style,
  info,
  clips: [
    { assetId: 'game1', inPoint: 30, duration: 7, tag: 'Kill', spotlight: { x: 0.3, y: 0.55 } },
    { assetId: 'game2', inPoint: 10, duration: 6, tag: 'Block' },
    { assetId: 'game1', inPoint: 80, duration: 8 },
  ],
  cards: { intro: 'intro', info: 'info', stats: 'stats', outro: 'outro', music: 'music', whoosh: 'whoosh', impact: 'impact' },
});

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
    for (const style of ['recruiting', 'hype', 'recap'] as const) {
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
});
