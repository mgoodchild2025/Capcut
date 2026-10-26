import { describe, expect, it } from 'vitest';
import type { Asset, Project } from '../model/types';
import { buildReel, type ReelInfo, type ReelInput, type ReelStyle } from './reel';
import { changeReel, cutsUntouched, rebuildReel } from './reelEdit';

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


/** A reel as the wizard leaves it: built, with its input recorded. */
const built = (inp: ReelInput): Project => {
  const p = buildReel(inp, assets);
  return { ...p, reel: { input: inp, musicId: 'm', built: p.clips.map((c) => c.id) } };
};
const texts = (p: Project) => p.clips.flatMap((c) => Object.values(c.graphic?.text ?? {}));
const withInfo = (inp: ReelInput, patch: Partial<ReelInfo>): ReelInput => ({ ...inp, info: { ...inp.info, ...patch } });

assets.music2 = asset('music2', 'audio', 80, { bpm: 90, beats: Array.from({ length: 120 }, (_, i) => i * (60 / 90)) });
assets.logo2 = asset('logo2', 'image', Infinity, { width: 400, height: 400 });

describe('changing a built reel', () => {
  it('renames the player everywhere, keeping a title typed over by hand', () => {
    const p0 = built(input('recruiting'));
    // Hand edit: the first lower third's tag.
    const lt = p0.clips.find((c) => c.graphic?.type === 'lowerThird')!;
    const p1: Project = { ...p0, clips: p0.clips.map((c) => (c.id === lt.id ? { ...c, graphic: { ...c.graphic!, text: { ...c.graphic!.text, tag: 'MONSTER KILL' } } } : c)) };
    const { project, unmatched } = changeReel(p1, assets, withInfo(p1.reel!.input, { name: 'Jordan Smith' }));
    expect(unmatched).toBe(0);
    expect(texts(project).join('|')).not.toMatch(/\bLee\b|\bLEE\b/);
    expect(texts(project).join('|')).toMatch(/JORDAN SMITH/);
    const lt2 = project.clips.find((c) => c.id === lt.id)!;
    expect(lt2.graphic!.text).toMatchObject({ tag: 'MONSTER KILL', name: 'Jordan Smith' });
    // The cuts don't move; the clips keep their ids.
    expect(project.clips.map((c) => [c.id, c.start, c.duration])).toEqual(p1.clips.map((c) => [c.id, c.start, c.duration]));
    expect(project.reel!.input.info.name).toBe('Jordan Smith');
  });

  it('recolours every title and the spotlight, except a title recoloured by hand', () => {
    const p0 = built(input('recruiting'));
    const fin = p0.clips.find((c) => c.graphic?.type === 'final')!;
    const p1: Project = { ...p0, clips: p0.clips.map((c) => (c.id === fin.id ? { ...c, graphic: { ...c.graphic!, colors: ['#000000', '#ffffff'] as [string, string] } } : c)) };
    const { project } = changeReel(p1, assets, withInfo(p1.reel!.input, { colors: ['#b91c1c', '#f8fafc'], look: 'neon' }));
    for (const c of project.clips.filter((c) => c.graphic && c.id !== fin.id)) {
      expect(c.graphic!.colors).toEqual(['#b91c1c', '#f8fafc']);
      expect(c.graphic!.look).toBe('neon');
    }
    expect(project.clips.find((c) => c.id === fin.id)!.graphic!.colors).toEqual(['#000000', '#ffffff']);
    expect(project.clips.find((c) => c.spotlight)!.spotlight!.color).toBe('#f8fafc');
  });

  it('swaps the logo on every title that showed it', () => {
    const p0 = built(input('recruiting'));
    const { project } = changeReel(p0, assets, { ...p0.reel!.input, cards: { ...p0.reel!.input.cards, logo: 'logo2' } });
    const logos = project.clips.filter((c) => c.graphic?.logo).map((c) => c.graphic!.logo);
    expect(logos.length).toBeGreaterThan(2);
    expect(new Set(logos)).toEqual(new Set(['logo2']));
  });

  it('swaps the song in place, leaving the cuts', () => {
    const p0 = built(input('hype'));
    const { project } = changeReel(p0, assets, { ...p0.reel!.input, cards: { ...p0.reel!.input.cards, music: 'music2' } });
    const songs = project.clips.filter((c) => c.kind === 'audio' && (c.assetId === 'music' || c.assetId === 'music2'));
    expect(songs.map((c) => c.assetId)).toEqual(['music2']);
    expect(songs[0].duration).toBeLessThanOrEqual(80);
    expect(project.clips.filter((c) => c.kind !== 'audio').map((c) => c.start)).toEqual(p0.clips.filter((c) => c.kind !== 'audio').map((c) => c.start));
  });

  it('knows when the cuts are as built', () => {
    const p0 = built(input('hype'));
    expect(cutsUntouched(p0, assets)).toBe(true);
    // Retyping a title is fine; trimming a play isn't.
    const typed: Project = { ...p0, clips: p0.clips.map((c) => (c.graphic?.type === 'open' ? { ...c, graphic: { ...c.graphic, text: { ...c.graphic.text, title: 'HI' } } } : c)) };
    expect(cutsUntouched(typed, assets)).toBe(true);
    const v = p0.clips.find((c) => c.kind === 'video')!;
    expect(cutsUntouched({ ...p0, clips: p0.clips.map((c) => (c.id === v.id ? { ...c, duration: c.duration - 0.5 } : c)) }, assets)).toBe(false);
    expect(cutsUntouched({ ...p0, clips: [...p0.clips, { ...v, id: 'mine' }] }, assets)).toBe(false);
    expect(cutsUntouched({ ...p0, reel: undefined }, assets)).toBe(false);
  });

  it('re-cuts to a new song, keeping hand edits and tracking fixes', () => {
    const p0 = built(input('hype'));
    const open = p0.clips.find((c) => c.graphic?.type === 'open')!;
    const v = p0.clips.find((c) => c.kind === 'video')!;
    const fix = { t: 31, x: 0.4, y: 0.5 };
    const p1: Project = {
      ...p0,
      clips: p0.clips.map((c) =>
        c.id === open.id ? { ...c, graphic: { ...c.graphic!, text: { ...c.graphic!.text, title: 'MY TITLE' } } } : c.id === v.id ? { ...c, follow: { path: [{ t: 30, x: 0.3, y: 0.5 }], color: '#fff', label: '#12', fixes: [fix] } } : c,
      ),
    };
    const next = { ...p1.reel!.input, cards: { ...p1.reel!.input.cards, music: 'music2' } };
    const fresh = buildReel(next, assets);
    const p2 = rebuildReel(p1, assets, next);
    // Cut like a fresh build to the new song...
    expect(p2.clips.filter((c) => c.kind === 'video').map((c) => c.start)).toEqual(fresh.clips.filter((c) => c.kind === 'video').map((c) => c.start));
    expect(p2.clips.some((c) => c.assetId === 'music2')).toBe(true);
    // ...with the edits carried over.
    expect(p2.clips.find((c) => c.graphic?.type === 'open')!.graphic!.text.title).toBe('MY TITLE');
    expect(p2.clips.find((c) => c.kind === 'video' && c.follow?.fixes)?.follow?.fixes).toEqual([fix]);
    expect(p2.id).toBe(p1.id);
    expect(p2.reel!.built).toEqual(p2.clips.map((c) => c.id));
    expect(cutsUntouched(p2, assets)).toBe(true);
  });

  it('takes the new frame when Edit reel changes the template', () => {
    const p0 = built(input('hype'));
    const p1 = rebuildReel(p0, assets, { ...p0.reel!.input, style: 'recruiting' });
    expect([p1.settings.width, p1.settings.height]).toEqual([1920, 1080]);
    expect([p0.settings.width, p0.settings.height]).not.toEqual([1920, 1080]);
  });

  it('drops the song when the music is turned off', () => {
    const p0 = built(input('hype'));
    const { project } = changeReel(p0, assets, { ...p0.reel!.input, cards: { ...p0.reel!.input.cards, music: undefined } });
    expect(project.clips.some((c) => c.assetId === 'music')).toBe(false);
    expect(project.clips.length).toBe(p0.clips.length - 1);
  });
});
