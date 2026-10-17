import type { Asset, Clip, Project } from '../model/types';
import { uid } from '../utils';
import { readDraftRaw, saveDraftRaw } from './persist';

/**
 * A `.clipforge` file holds a whole draft: a short text marker, the length of a JSON header,
 * the header (project, thumbnail, media details) and then each media file's bytes, back to back.
 * Media is never copied into memory: saving stitches stored blobs together and opening slices them.
 */
const MAGIC = 'CLIPFORGE1\n';
export const PROJECT_EXT = '.clipforge';

interface Header {
  app: 'ClipForge';
  version: 1;
  savedAt: number;
  project: Project;
  thumbnail?: string;
  assets: { meta: Omit<Asset, 'url'>; size: number; type: string }[];
}

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

/** Every asset a clip needs: its own media and, for graphics, logos, depth maps and roster photos. */
export function mediaRefs(c: Clip): string[] {
  const g = c.graphic;
  return [c.assetId, g?.logo, g?.oppLogo, g?.depth, ...(g?.players ?? []).map((p) => p.photo)].filter((x): x is string => !!x);
}

export function remapClip(c: Clip, map: (id: string) => string): Clip {
  const g = c.graphic;
  return {
    ...c,
    assetId: c.assetId && map(c.assetId),
    graphic: g && {
      ...g,
      logo: g.logo && map(g.logo),
      oppLogo: g.oppLogo && map(g.oppLogo),
      depth: g.depth && map(g.depth),
      players: g.players?.map((p) => ({ ...p, photo: p.photo && map(p.photo) })),
    },
  };
}

const fileName = (name: string) => `${name.replace(/[^\w\- ]+/g, '').trim() || 'project'}${PROJECT_EXT}`;

/** Packs a stored draft into a single file. */
export async function draftToFile(id: string): Promise<File> {
  const raw = await readDraftRaw(id);
  if (!raw) throw new ProjectFileError('That draft could not be found.');
  return packProject(raw);
}

export function packProject(raw: { project: Project; thumbnail?: string; assets: { meta: Omit<Asset, 'url'>; blob: Blob }[] }): File {
  // Only media the timeline uses (clips, and what graphics draw); deleted clips can leave orphans behind.
  const used = new Set(raw.project.clips.flatMap(mediaRefs));
  const assets = raw.assets.filter((a) => used.has(a.meta.id));
  const header: Header = {
    app: 'ClipForge',
    version: 1,
    savedAt: Date.now(),
    project: raw.project,
    thumbnail: raw.thumbnail,
    assets: assets.map((a) => ({ meta: a.meta, size: a.blob.size, type: a.blob.type })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length, true);
  return new File([MAGIC, len, json, ...assets.map((a) => a.blob)], fileName(raw.project.name), { type: 'application/octet-stream' });
}

/** Reads a project file back into a project and its media. */
export async function readProjectFile(file: Blob): Promise<{ project: Project; thumbnail?: string; assets: { meta: Omit<Asset, 'url'>; blob: Blob }[] }> {
  const head = await file.slice(0, MAGIC.length + 4).arrayBuffer();
  if (head.byteLength < MAGIC.length + 4 || new TextDecoder().decode(head.slice(0, MAGIC.length)) !== MAGIC) {
    throw new ProjectFileError("That isn't a ClipForge project file.");
  }
  const len = new DataView(head, MAGIC.length).getUint32(0, true);
  const start = MAGIC.length + 4;
  let header: Header;
  try {
    header = JSON.parse(await file.slice(start, start + len).text()) as Header;
  } catch {
    throw new ProjectFileError('The project file is damaged.');
  }
  if (header.app !== 'ClipForge' || header.version !== 1) throw new ProjectFileError('This project file comes from a newer version of ClipForge.');
  let offset = start + len;
  const assets = header.assets.map((a) => {
    const blob = file.slice(offset, offset + a.size, a.type);
    offset += a.size;
    return { meta: a.meta, blob };
  });
  if (offset > file.size) throw new ProjectFileError('The project file is incomplete. Try saving it again.');
  return { project: header.project, thumbnail: header.thumbnail, assets };
}

/** Adds a project file to the drafts as a new draft (fresh ids, so the same file can be opened twice). Returns its id. */
export async function importProjectFile(file: Blob): Promise<string> {
  const { project, thumbnail, assets } = await readProjectFile(file);
  const ids = new Map(assets.map((a) => [a.meta.id, uid('a_')]));
  const now = Date.now();
  const next: Project = {
    ...project,
    id: uid('p_'),
    updatedAt: now,
    clips: project.clips.map((c) => remapClip(c, (id) => ids.get(id) ?? id)),
  };
  await saveDraftRaw(
    next,
    assets.map((a) => ({ meta: { ...a.meta, id: ids.get(a.meta.id)!, blob: undefined }, blob: a.blob })),
    thumbnail,
  );
  return next.id;
}
