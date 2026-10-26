import { describe, expect, it } from 'vitest';
import { createMediaClip, createProject } from '../model/factory';
import type { Asset } from '../model/types';
import { packProject, readProjectFile } from './projectFile';

const meta = (id: string, kind: Asset['kind']): Omit<Asset, 'url'> => ({ id, name: `${id}.bin`, kind, duration: 3, width: 640, height: 360, size: 0, hasAudio: false });

describe('project files', () => {
  it('round-trips the project and every used media file byte for byte', async () => {
    const project = createProject(1080, 1920, 'Rockets lineup');
    const a = { meta: meta('a1', 'video'), blob: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/mp4' }) };
    const b = { meta: meta('a2', 'image'), blob: new Blob(['png-bytes'], { type: 'image/png' }) };
    const orphan = { meta: meta('a3', 'audio'), blob: new Blob(['unused']) };
    project.clips = [{ ...createMediaClip({ ...a.meta, url: '' }), assetId: 'a1' }, { ...createMediaClip({ ...b.meta, url: '' }), assetId: 'a2' }];
    const file = packProject({ project, thumbnail: 'data:image/jpeg;base64,xx', assets: [a, orphan, b] });
    expect(file.name).toBe('Rockets lineup.clipforge');

    const back = await readProjectFile(file);
    expect(back.project).toEqual(project);
    expect(back.thumbnail).toBe('data:image/jpeg;base64,xx');
    expect(back.assets.map((x) => x.meta.id)).toEqual(['a1', 'a2']);
    expect([...new Uint8Array(await back.assets[0].blob.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect(back.assets[0].blob.type).toBe('video/mp4');
    expect(await back.assets[1].blob.text()).toBe('png-bytes');
  });

  it('rejects other files and truncated ones', async () => {
    await expect(readProjectFile(new Blob(['hello world, not a project']))).rejects.toThrow(/isn't a ClipForge project/);
    const project = createProject(1920, 1080, 'x');
    const a = { meta: meta('a1', 'video'), blob: new Blob([new Uint8Array(100)]) };
    project.clips = [{ ...createMediaClip({ ...a.meta, url: '' }), assetId: 'a1' }];
    const file = packProject({ project, assets: [a] });
    await expect(readProjectFile(file.slice(0, file.size - 10))).rejects.toThrow(/incomplete/);
  });

  it('keeps media that only graphics use (logos, depth maps, roster photos)', async () => {
    const project = createProject(1080, 1920, 'Graphics');
    const files = ['photo', 'logo', 'opp', 'depth', 'tile'].map((id) => ({ meta: meta(id, 'image'), blob: new Blob([id]) }));
    project.clips = [
      { ...createMediaClip({ ...files[0].meta, url: '' }), kind: 'graphic', assetId: 'photo', graphic: { type: 'playerCard', colors: ['#000', '#fff'], text: {}, logo: 'logo', oppLogo: 'opp', depth: 'depth', players: [{ number: '1', name: 'A', photo: 'tile' }] } },
    ];
    const back = await readProjectFile(packProject({ project, assets: files }));
    expect(back.assets.map((a) => a.meta.id).sort()).toEqual(['depth', 'logo', 'opp', 'photo', 'tile']);
  });
});

describe('analysed games in project files', () => {
  it('follow their video to its new id', async () => {
    const { remapMatches } = await import('./projectFile');
    const m = remapMatches({ a1: { assetId: 'a1', analyzedAt: 1, rallies: [{ id: 'r', start: 1, end: 5, peak: 3, score: 100, reasons: [] }] } }, (id) => (id === 'a1' ? 'b9' : id));
    expect(Object.keys(m!)).toEqual(['b9']);
    expect(m!.b9.assetId).toBe('b9');
    expect(m!.b9.rallies[0].end).toBe(5);
    expect(remapMatches(undefined, (x) => x)).toBeUndefined();
  });
});

describe('a recorded reel in project files', () => {
  it('keeps the media it was built from, at their new ids', async () => {
    const { reelRefs, remapReel } = await import('./projectFile');
    const reel = {
      input: {
        style: 'hype' as const,
        info: {} as never,
        clips: [{ assetId: 'game', inPoint: 1, duration: 4 }],
        cards: { music: 'song', logo: 'logo', players: { r1: 'p1' }, cutouts: ['p1'], depths: { ph: 'dm' } },
      },
      musicId: 'asset:song',
      built: ['c1'],
    };
    expect(reelRefs(reel).sort()).toEqual(['dm', 'game', 'logo', 'p1', 'p1', 'ph', 'song']);
    const r = remapReel(reel, (id) => `n_${id}`)!;
    expect(r.input.clips[0].assetId).toBe('n_game');
    expect(r.input.cards).toMatchObject({ music: 'n_song', logo: 'n_logo', players: { r1: 'n_p1' }, cutouts: ['n_p1'], depths: { n_ph: 'n_dm' } });
    expect(r.musicId).toBe('asset:n_song');
    expect(r.built).toEqual(['c1']);
  });
});
