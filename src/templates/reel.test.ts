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
    for (const style of ['recruiting', 'hype', 'recap', 'spotlight', 'team', 'lineup', 'victory', 'potw', 'matchup'] as const) {
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

  it('scores points-based sports by totals, with their own period names', () => {
    const quarters: [string, string][] = [
      ['18', '12'],
      ['14', '20'],
      ['22', '15'],
      ['16', '19'],
    ];
    const p = buildReel(input('recruiting', { info: { ...info, sport: 'basketball', sets: quarters } }), assets);
    const fin = graphics(p, 'final')[0].graphic!;
    expect(fin.scoring).toBe('points');
    expect(fin.text.periodPrefix).toBe('Q');
    // 70-66 on points, though they won only two of four quarters.
    expect(fin.text.result).toBe('ROCKETS 17 ELITE win 70-66');
    expect(graphics(p, 'scoreBug')[0].graphic!.text.periodLabel).toBe('QTR');
  });

  it('handles innings and a loss', () => {
    const innings: [string, string][] = Array.from({ length: 9 }, (_, i) => [String(i % 3 === 0 ? 1 : 0), String(i % 4 === 0 ? 1 : 0)]);
    const p = buildReel(input('recap', { info: { ...info, name: 'Rockets', sport: 'baseball', sets: [...innings.slice(0, 8), ['0', '2']] } }), assets);
    const fin = graphics(p, 'final')[0].graphic!;
    expect(fin.sets!.length).toBe(9);
    expect(fin.text.periodPrefix).toBe('');
    expect(fin.text.result).toBe('WESTSIDE STORM win 4-3');
  });

  it('keeps volleyball on sets won', () => {
    const p = buildReel(input('recap', { info: { ...info, name: 'Rockets' } }), assets);
    const fin = graphics(p, 'final')[0].graphic!;
    expect(fin.scoring).toBe('sets');
    expect(fin.text.result).toBe('ROCKETS win 2-1');
  });
});

describe('player reels from a team reel', () => {
  const team = () =>
    input('team', {
      clips: [
        { assetId: 'game1', inPoint: 30, duration: 7, tag: 'Kill', player: 'r1' },
        { assetId: 'game2', inPoint: 10, duration: 6, tag: 'Kill', player: 'r1' },
        { assetId: 'game1', inPoint: 50, duration: 5, tag: 'Ace', player: 'r1' },
        { assetId: 'game2', inPoint: 30, duration: 6, tag: 'Dig', player: 'r3' },
        { assetId: 'game1', inPoint: 80, duration: 8 },
      ],
      info: { ...info, name: 'Rockets' },
    });

  it('makes one per credited player, with their plays and stats from the labels', async () => {
    const { playerReelInputs, plural } = await import('./playerReels');
    const reels = playerReelInputs(team(), 'hype');
    expect(reels.map((r) => r.player.key)).toEqual(['r1', 'r3']);
    const jordan = reels[0].input;
    expect(jordan.style).toBe('hype');
    expect(jordan.clips).toHaveLength(3);
    expect(jordan.info.name).toBe('Jordan Lee');
    expect(jordan.info.club).toBe('Rockets');
    expect(jordan.info.stats).toEqual([
      ['Kills', '2'],
      ['Aces', '1'],
    ]);
    expect(jordan.cards.photo).toBe('cut');
    expect([plural('Catch'), plural('RBI'), plural('Home run'), plural('Assists')]).toEqual(['Catches', 'RBI', 'Home runs', 'Assists']);
  });

  it('builds each into a full player reel with the team score', async () => {
    const { playerReelInputs } = await import('./playerReels');
    const [jordan] = playerReelInputs(team(), 'spotlight');
    const p = buildReel(jordan.input, assets);
    expect(p.settings.width / p.settings.height).toBeCloseTo(1080 / 1350);
    expect(main(p).filter((c) => c.kind === 'video')).toHaveLength(3);
    expect(graphics(p, 'playerCard')).toHaveLength(1);
    expect(graphics(p, 'stats')[0].graphic!.text.title).toBe('vs Westside Storm');
    expect(graphics(p, 'final')).toHaveLength(1);
    expect(graphics(p, 'lowerThird')[0].graphic!.text.name).toBe('Jordan Lee');
  });
});

describe('instant replays', () => {
  it('re-runs the play in slow motion with a REPLAY wipe and the analyst pen', () => {
    const p = buildReel(input('recruiting', { clips: [{ assetId: 'game1', inPoint: 30, duration: 7, tag: 'Kill', spotlight: { x: 0.3, y: 0.55 }, replay: true }] }), assets);
    const vids = main(p).filter((c) => c.kind === 'video');
    expect(vids).toHaveLength(2);
    const [play, rep] = vids;
    expect(rep.speed).toBe(0.5);
    expect(rep.inPoint).toBeGreaterThanOrEqual(30);
    expect(rep.inPoint + 2.4).toBeLessThanOrEqual(37.01);
    expect(rep.start).toBeCloseTo(play.start + play.duration);
    expect(rep.hold).toBeGreaterThan(1);
    const [wipe] = graphics(p, 'replay');
    expect(wipe.start + 0.36).toBeCloseTo(rep.start);
    expect(wipe.graphic!.text.tag).toBe('Kill');
    const [tele] = graphics(p, 'telestrator');
    const [ring, arrow] = tele.graphic!.marks!;
    expect(ring.kind).toBe('circle');
    // 16:9 footage in a 16:9 reel: the ring sits on the spotted player.
    expect(ring.pts[0][0]).toBeCloseTo(0.3, 2);
    expect(ring.pts[0][1]).toBeCloseTo(0.55, 2);
    expect(arrow.kind).toBe('arrow');
  });

  it('skips the pen when no player is spotted', () => {
    const p = buildReel(input('hype', { clips: [{ assetId: 'game1', inPoint: 30, duration: 7, replay: true }] }), assets);
    expect(graphics(p, 'replay')).toHaveLength(1);
    expect(graphics(p, 'telestrator')).toHaveLength(0);
  });

  it('follows a tracked player with the marker and the frame', () => {
    const path = Array.from({ length: 71 }, (_, i) => ({ t: 30 + i / 10, x: 0.2 + i / 200, y: 0.5 }));
    const p = buildReel(input('hype', { clips: [{ assetId: 'game1', inPoint: 30, duration: 7, spotlight: { x: 0.2, y: 0.5 }, path }] }), assets);
    const [v] = main(p).filter((c) => c.kind === 'video');
    expect(v.follow?.label).toBe('#12');
    const keys = v.keyframes?.x ?? [];
    expect(keys.length).toBeGreaterThan(1);
    // The player moves right, so the frame pans left (x falls).
    expect(keys[keys.length - 1].v).toBeLessThan(keys[0].v);
  });
});

describe('crowd', () => {
  const withCrowd = { ...assets, crowd: asset('crowd', 'audio', 12) };
  it('cheers under the final score and the send-off', () => {
    const p = buildReel(input('recruiting', { cards: { ...input('recruiting').cards, crowd: 'crowd' } }), withCrowd);
    const [final] = graphics(p, 'final');
    const cheer = p.clips.find((c) => c.assetId === 'crowd')!;
    expect(cheer.start).toBeCloseTo(final.start - 0.3);
    const total = Math.max(...p.clips.map((c) => c.start + c.duration));
    expect(cheer.start + cheer.duration).toBeLessThanOrEqual(total + 1e-6);
    expect(cheer.audioFadeOut).toBeGreaterThan(0);
  });
  it('stays quiet before the game (starting lineup)', () => {
    const p = buildReel(input('lineup', { cards: { ...input('lineup').cards, crowd: 'crowd' } }), withCrowd);
    expect(p.clips.some((c) => c.assetId === 'crowd')).toBe(false);
  });
});

describe('victory reel', () => {
  it('opens on the win with the score, cuts plays to the beat and celebrates', () => {
    const withCrowd = { ...assets, crowd: asset('crowd', 'audio', 12) };
    const p = buildReel(input('victory', { info: { ...info, name: 'Rockets', record: '25-6' }, cards: { ...input('victory').cards, crowd: 'crowd' } }), withCrowd);
    const m = contiguous(p);
    expect(m[0].graphic).toMatchObject({ type: 'victory', logo: 'logo', oppLogo: 'opp', text: { kicker: 'FINAL', title: 'VICTORY', score: '2-1', sub: 'ROCKETS over WESTSIDE STORM' } });
    const t = types(p);
    expect(t.slice(-3)).toEqual(['stats', 'final', 'closer']);
    expect(graphics(p, 'stats')[0].graphic!.text.title).toBe('Game stats');
    expect(graphics(p, 'closer')[0].graphic!.text).toMatchObject({ kicker: 'WE WIN', title: 'ROCKETS!', sub: 'Record 25-6 · Lincoln High' });
    // Plays credited to players, like a team reel.
    expect(graphics(p, 'lowerThird')[0].graphic!.text).toMatchObject({ name: 'Jordan Lee', tag: 'Kill' });
    for (const c of m) expect(Math.abs(c.start / 2 - Math.round(c.start / 2))).toBeLessThan(1e-6);
    // The crowd goes up under the opening and again under the result.
    const cheers = p.clips.filter((c) => c.assetId === 'crowd').map((c) => c.start);
    expect(cheers[0]).toBeCloseTo(0.3);
    expect(cheers[1]).toBeCloseTo(graphics(p, 'final')[0].start - 0.3);
  });

  it('still makes a title without a score, and owns a loss', () => {
    const none = buildReel(input('victory', { info: { ...info, name: 'Rockets', sets: [] } }), assets);
    expect(main(none)[0].graphic!.text).toMatchObject({ title: 'VICTORY', score: '' });
    const lost = buildReel(input('victory', { info: { ...info, name: 'Rockets', sets: [['20', '25'], ['18', '25']] } }), assets);
    expect(main(lost)[0].graphic!.text).toMatchObject({ title: 'ROCKETS', score: '0-2' });
  });
});

describe('play of the week', () => {
  const play = { assetId: 'game1', inPoint: 30, duration: 7, tag: 'Kill', spotlight: { x: 0.3, y: 0.55 } };
  it('awards the play, runs it at full speed, then replays it slower and slower', () => {
    const p = buildReel(input('potw', { info: { ...info, award: 'Play of the Week', week: 'Week 7' }, clips: [play] }), assets);
    const m = contiguous(p);
    expect(m[0].graphic).toMatchObject({ type: 'potw', text: { award: 'Play of the Week', week: 'Week 7', name: 'JORDAN LEE' } });
    const vids = m.filter((c) => c.kind === 'video');
    expect(vids.map((v) => v.speed)).toEqual([1, 0.5, 0.3]);
    expect(vids[0].hold).toBeGreaterThan(0);
    const reps = graphics(p, 'replay').map((c) => c.graphic!.text.tag);
    expect(reps).toEqual(['Kill', 'Super slow-mo']);
    expect(graphics(p, 'telestrator').length).toBe(1);
    // The badge rides over the play and its replays.
    const [badge] = graphics(p, 'badge');
    expect(badge.graphic!.text).toEqual({ title: 'PLAY OF THE WEEK', sub: 'WEEK 7' });
    expect(badge.start).toBeCloseTo(vids[0].start);
    expect(badge.start + badge.duration).toBeCloseTo(vids[2].start + vids[2].duration);
    // The player card comes after the replays: the reveal.
    expect(types(p).slice(-3)).toEqual(['playerCard', 'stats', 'closer']);
    expect(graphics(p, 'closer')[0].graphic!.text).toMatchObject({ kicker: 'PLAY OF THE WEEK', title: 'JORDAN LEE', sub: 'Week 7 · Rockets 17 Elite' });
    expect(p.name).toBe('Jordan Lee Play of the Week');
  });

  it('replays every other angle once, without the super slow-mo', () => {
    const p = buildReel(input('potw', { clips: [play, { assetId: 'game2', inPoint: 10, duration: 6 }] }), assets);
    const vids = main(p).filter((c) => c.kind === 'video');
    expect(vids.map((v) => [v.assetId, v.speed])).toEqual([['game1', 1], ['game1', 0.5], ['game2', 0.5]]);
    expect(graphics(p, 'replay').map((c) => c.graphic!.text.tag)).toEqual(['Kill', 'Angle 2']);
  });
});

describe('matchup lineup', () => {
  const opp = [
    { key: 'o1', number: '3', name: 'Riley Stone', position: 'Setter', starter: true },
    { key: 'o2', number: '8', name: 'Casey Fox', position: 'Libero', starter: false },
    { key: 'o3', number: '10', name: 'Drew Hale', position: 'Opposite', starter: true },
  ];
  const base = { ...info, name: 'Rockets', oppRoster: opp, oppColors: ['#b91c1c', '#f8fafc'] as [string, string], oppRecord: '19-9', venue: 'Fri 7 PM · Lincoln Gym' };
  it('versus title, their starters in their colours, ours, then the face-off', () => {
    const p = buildReel(input('matchup', { info: base, clips: [], cards: { ...input('matchup').cards, players: { r1: 'cut', o1: 'photo' } } }), assets);
    const m = contiguous(p);
    expect(types(p)).toEqual(['versus', 'open', 'playerCard', 'playerCard', 'open', 'playerCard', 'playerCard', 'playerCard', 'versus']);
    expect(m[0].graphic).toMatchObject({ logo: 'logo', oppLogo: 'opp', oppColors: ['#b91c1c', '#f8fafc'], text: { kicker: 'GAME DAY', usName: 'ROCKETS', themName: 'WESTSIDE STORM', usSub: '24-6', themSub: '19-9' } });
    // Visitors first, in their colours with their logo.
    expect(m[1].graphic).toMatchObject({ colors: ['#b91c1c', '#f8fafc'], logo: 'opp', text: { kicker: 'STARTING FOR', title: 'WESTSIDE STORM' } });
    expect(m[2]).toMatchObject({ assetId: 'photo', graphic: { colors: ['#b91c1c', '#f8fafc'], logo: 'opp', text: { number: '3', last: 'Stone', count: '1/2' } } });
    expect(m[3].graphic!.text).toMatchObject({ number: '10', count: '2/2' });
    // Then us.
    expect(m[4].graphic).toMatchObject({ colors: info.colors, logo: 'logo', text: { kicker: 'AND STARTING FOR', title: 'ROCKETS' } });
    expect(m[5]).toMatchObject({ assetId: 'cut', graphic: { colors: info.colors, text: { number: '12', count: '1/3' } } });
    expect(m[8].graphic!.text).toMatchObject({ kicker: 'FIRST SERVE', usName: 'ROCKETS', themName: 'WESTSIDE STORM' });
    // Every cut on a beat; their quicker cards on half bars, ours a full bar or more.
    for (const x of m) expect(Math.abs(x.start - Math.round(x.start))).toBeLessThan(1e-6);
    expect(m[2].duration).toBe(3);
    expect(m[5].duration).toBe(4);
    // The stinger into their lineup wears their colours.
    const stingers = p.clips.filter((c) => c.graphic?.type === 'stinger');
    expect(stingers[0].graphic).toMatchObject({ colors: ['#b91c1c', '#f8fafc'], logo: 'opp' });
    expect(stingers[1].graphic).toMatchObject({ colors: info.colors, logo: 'logo' });
    expect(graphics(p, 'scoreBug').length + graphics(p, 'final').length + graphics(p, 'stats').length).toBe(0);
  });

  it('works with only our lineup, and picks opponent colours that differ from ours', () => {
    const p = buildReel(input('matchup', { info: { ...info, name: 'Rockets', oppRoster: [] }, clips: [] }), assets);
    expect(types(p)).toEqual(['versus', 'open', 'playerCard', 'playerCard', 'playerCard', 'versus']);
    const oc = main(p)[0].graphic!.oppColors!;
    expect(oc[0]).not.toBe(info.colors[0]);
    expect(main(p)[1].graphic!.text.kicker).toBe('STARTING FOR');
  });

  it('opens each sport its own way', () => {
    const p = buildReel(input('matchup', { info: { ...base, sport: 'basketball' }, clips: [] }), assets);
    expect(main(p).at(-1)!.graphic!.text.kicker).toBe('TIP-OFF');
  });
});

describe('cover frame', () => {
  it('every style shows its finished title as the cover, before it wipes away', () => {
    for (const style of ['recruiting', 'hype', 'recap', 'spotlight', 'team', 'lineup', 'victory', 'potw', 'matchup'] as const) {
      const p = buildReel(input(style), assets);
      const first = main(p)[0];
      expect(first.kind, style).toBe('graphic');
      expect(p.poster, style).toBeGreaterThan(1.5);
      expect(p.poster!, style).toBeLessThanOrEqual(first.start + first.duration - 0.5);
    }
  });
});

describe('songs that start between beats', () => {
  it('start on a beat, so cuts on the bar land on the music', () => {
    // 120 BPM with the first beat 0.3 s in, like most recordings.
    const song = asset('song', 'audio', 90, { bpm: 120, beats: Array.from({ length: 170 }, (_, i) => 0.3 + i * 0.5) });
    const p = buildReel(input('hype', { cards: { ...input('hype').cards, music: 'song' } }), { ...assets, song });
    const m = p.clips.find((c) => c.assetId === 'song')!;
    expect(m.inPoint).toBeCloseTo(0.3);
    const beatsOnTimeline = song.beats!.map((b) => b - m.inPoint);
    for (const c of main(p)) expect(Math.min(...beatsOnTimeline.map((b) => Math.abs(b - c.start)))).toBeLessThan(0.01);
    expect(p.markers![0].t).toBeCloseTo(0);
  });
});
