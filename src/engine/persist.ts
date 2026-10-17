import type { Asset, Project } from '../model/types';

const DB_NAME = 'clipforge';
const DB_VERSION = 1;

interface ProjectRecord {
  id: string;
  project: Project;
  thumbnail?: string;
  updatedAt: number;
}

interface AssetRecord {
  id: string;
  projectId: string;
  meta: Omit<Asset, 'url'>;
}

export interface DraftSummary {
  id: string;
  name: string;
  updatedAt: number;
  thumbnail?: string;
  width: number;
  height: number;
  duration: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('projects', { keyPath: 'id' });
        const assets = d.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('projectId', 'projectId');
        d.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const stripUrl = ({ url: _url, ...meta }: Asset) => meta;

export async function saveAssetBlob(projectId: string, asset: Asset, blob: Blob): Promise<void> {
  const d = await db();
  const tx = d.transaction(['assets', 'blobs'], 'readwrite');
  tx.objectStore('assets').put({ id: asset.id, projectId, meta: stripUrl(asset) } satisfies AssetRecord);
  tx.objectStore('blobs').put(blob, asset.id);
  await done(tx);
}

export async function saveProject(project: Project, assets: Asset[], thumbnail?: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'assets'], 'readwrite');
  const prev = await request(tx.objectStore('projects').get(project.id) as IDBRequest<ProjectRecord | undefined>);
  tx.objectStore('projects').put({
    id: project.id,
    project,
    thumbnail: thumbnail ?? prev?.thumbnail,
    updatedAt: project.updatedAt,
  } satisfies ProjectRecord);
  const store = tx.objectStore('assets');
  for (const a of assets) store.put({ id: a.id, projectId: project.id, meta: stripUrl(a) } satisfies AssetRecord);
  await done(tx);
}

export async function listDrafts(): Promise<DraftSummary[]> {
  const d = await db();
  const tx = d.transaction('projects', 'readonly');
  const all = await request(tx.objectStore('projects').getAll() as IDBRequest<ProjectRecord[]>);
  return all
    .map((r) => ({
      id: r.id,
      name: r.project.name,
      updatedAt: r.updatedAt,
      thumbnail: r.thumbnail,
      width: r.project.settings.width,
      height: r.project.settings.height,
      duration: r.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDraft(id: string): Promise<{ project: Project; assets: Record<string, Asset> } | null> {
  const d = await db();
  const tx = d.transaction(['projects', 'assets', 'blobs'], 'readonly');
  const rec = await request(tx.objectStore('projects').get(id) as IDBRequest<ProjectRecord | undefined>);
  if (!rec) return null;
  const records = await request(
    tx.objectStore('assets').index('projectId').getAll(id) as IDBRequest<AssetRecord[]>,
  );
  const assets: Record<string, Asset> = {};
  for (const r of records) {
    const blob = await request(tx.objectStore('blobs').get(r.id) as IDBRequest<Blob | undefined>);
    if (!blob) continue;
    assets[r.id] = { ...r.meta, url: URL.createObjectURL(blob) };
  }
  return { project: rec.project, assets };
}

export async function deleteDraft(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'assets', 'blobs'], 'readwrite');
  const ids = await request(tx.objectStore('assets').index('projectId').getAllKeys(id));
  for (const key of ids) {
    tx.objectStore('assets').delete(key);
    tx.objectStore('blobs').delete(key);
  }
  tx.objectStore('projects').delete(id);
  await done(tx);
}

export async function renameDraft(id: string, name: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('projects', 'readwrite');
  const rec = await request(tx.objectStore('projects').get(id) as IDBRequest<ProjectRecord | undefined>);
  if (rec) tx.objectStore('projects').put({ ...rec, project: { ...rec.project, name } });
  await done(tx);
}

export async function deleteAssetRecord(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['assets', 'blobs'], 'readwrite');
  tx.objectStore('assets').delete(id);
  tx.objectStore('blobs').delete(id);
  await done(tx);
}

/** Everything stored for a draft, with the media as blobs (for saving it to a file). */
export async function readDraftRaw(
  id: string,
): Promise<{ project: Project; thumbnail?: string; assets: { meta: Omit<Asset, 'url'>; blob: Blob }[] } | null> {
  const d = await db();
  const tx = d.transaction(['projects', 'assets', 'blobs'], 'readonly');
  const rec = await request(tx.objectStore('projects').get(id) as IDBRequest<ProjectRecord | undefined>);
  if (!rec) return null;
  const records = await request(tx.objectStore('assets').index('projectId').getAll(id) as IDBRequest<AssetRecord[]>);
  const assets: { meta: Omit<Asset, 'url'>; blob: Blob }[] = [];
  for (const r of records) {
    const blob = await request(tx.objectStore('blobs').get(r.id) as IDBRequest<Blob | undefined>);
    if (blob) assets.push({ meta: r.meta, blob });
  }
  return { project: rec.project, thumbnail: rec.thumbnail, assets };
}

/** Stores a whole draft (project, media and all) in one go, e.g. one opened from a file. */
export async function saveDraftRaw(project: Project, assets: { meta: Omit<Asset, 'url'>; blob: Blob }[], thumbnail?: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'assets', 'blobs'], 'readwrite');
  tx.objectStore('projects').put({ id: project.id, project, thumbnail, updatedAt: project.updatedAt } satisfies ProjectRecord);
  for (const a of assets) {
    tx.objectStore('assets').put({ id: a.meta.id, projectId: project.id, meta: a.meta } satisfies AssetRecord);
    tx.objectStore('blobs').put(a.blob, a.meta.id);
  }
  await done(tx);
}
