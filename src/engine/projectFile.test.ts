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
});
