import { engine } from './engine/engine';
import { buildFilmstrip, buildWaveform, importFile } from './engine/media';
import { deleteAssetRecord, loadDraft, saveAssetBlob, saveProject } from './engine/persist';
import { createMediaClip, createProject, createStickerClip, createTextClip } from './model/factory';
import {
  activeLayers,
  appendToMain,
  clipEnd,
  duplicateClip,
  getMainTrack,
  placeClip,
  removeClip,
  rippleDelete,
  splitClip,
  trackClips,
} from './model/ops';
import type { Asset, Clip, Project, TextStyle, TransitionKind } from './model/types';
import { addAsset, commit, edit, openProject, patchAsset, select, selectedClip, toast, useEditor } from './store';

const get = useEditor.getState;

export async function importFiles(files: Iterable<File>): Promise<Asset[]> {
  const list = [...files];
  const imported: Asset[] = [];
  for (const file of list) {
    useEditor.setState((s) => ({ importing: s.importing + 1 }));
    try {
      const asset = await importFile(file);
      addAsset(asset);
      imported.push(asset);
      const projectId = get().project.id;
      void saveAssetBlob(projectId, asset, file).catch((e) => console.warn('Could not store media', e));
      void enrich(asset, file);
    } catch (err) {
      console.error(err);
      toast(`Couldn't import ${file.name}`);
    } finally {
      useEditor.setState((s) => ({ importing: s.importing - 1 }));
    }
  }
  return imported;
}

async function enrich(asset: Asset, blob: Blob) {
  if (asset.kind === 'video') {
    try {
      patchAsset(asset.id, { filmstrip: await buildFilmstrip(asset) });
    } catch (e) {
      console.warn('Filmstrip failed', e);
    }
  }
  if (asset.kind !== 'image') {
    const waveform = await buildWaveform(blob);
    patchAsset(asset.id, { waveform: waveform ?? [], hasAudio: !!waveform && waveform.length > 0 });
  }
}

export function removeAsset(id: string) {
  const inUse = get().project.clips.some((c) => c.assetId === id);
  if (inUse) {
    edit((p) => ({ ...p, clips: p.clips.filter((c) => c.assetId !== id) }));
  }
  const { [id]: gone, ...rest } = get().assets;
  useEditor.setState({ assets: rest });
  if (gone) URL.revokeObjectURL(gone.url);
  void deleteAssetRecord(id);
}

/** Add media to the timeline. Without a position it appends to the main track (video/images) or the playhead. */
export function addAssetToTimeline(assetId: string, at?: { start: number; trackId?: string }) {
  const asset = get().assets[assetId];
  if (!asset) return;
  const clip = createMediaClip(asset);
  let next: Project;
  if (at) {
    next = placeClip(get().project, { ...clip, start: Math.max(0, at.start) }, at.trackId);
  } else if (asset.kind === 'audio') {
    next = placeClip(get().project, { ...clip, start: get().currentTime });
  } else {
    next = appendToMain(get().project, clip);
  }
  commit(next);
  select(clip.id);
}

export function addText(style: Partial<TextStyle> = {}) {
  const clip = createTextClip(style, get().currentTime);
  commit(placeClip(get().project, clip));
  select(clip.id);
}

export function addSticker(sticker: string) {
  const clip = createStickerClip(sticker, get().currentTime);
  commit(placeClip(get().project, clip));
  select(clip.id);
}

/** Split the selected clip at the playhead, or every clip under the playhead if none is selected. */
export function splitAtPlayhead() {
  const s = get();
  const t = s.currentTime;
  const sel = selectedClip(s);
  if (sel) {
    const next = splitClip(s.project, sel.id, t);
    if (next) commit(next);
    else toast('Move the playhead inside the clip to split it');
    return;
  }
  let p = s.project;
  let changed = false;
  for (const c of s.project.clips) {
    if (t > c.start && t < clipEnd(c)) {
      const r = splitClip(p, c.id, t);
      if (r) {
        p = r;
        changed = true;
      }
    }
  }
  if (changed) commit(p);
}

export function deleteSelected(ripple = false) {
  const sel = selectedClip(get());
  if (!sel) return;
  const track = get().project.tracks.find((t) => t.id === sel.trackId);
  // The main track is magnetic, as in CapCut: gaps close automatically.
  const useRipple = ripple || !!track?.main;
  edit((p) => (useRipple ? rippleDelete(p, sel.id) : removeClip(p, sel.id)));
}

export function duplicateSelected() {
  const sel = selectedClip(get());
  if (!sel) return;
  const before = new Set(get().project.clips.map((c) => c.id));
  edit((p) => duplicateClip(p, sel.id));
  const added = get().project.clips.find((c) => !before.has(c.id));
  if (added) select(added.id);
}

export function updateSelected(patch: Partial<Clip> | ((c: Clip) => Partial<Clip>), history = true) {
  const sel = selectedClip(get());
  if (!sel) return;
  edit(
    (p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === sel.id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)),
    }),
    history,
  );
}

/** Clip a library action (filter/transition) applies to: the selection, else the visual clip under the playhead. */
export function targetVisualClip(): Clip | null {
  const s = get();
  const sel = selectedClip(s);
  if (sel) return sel;
  const layers = activeLayers(s.project, s.currentTime).filter((l) => l.clip.kind === 'video' || l.clip.kind === 'image');
  return layers.length ? layers[layers.length - 1].clip : null;
}

export function applyFilter(filterId: string) {
  const target = targetVisualClip();
  if (!target) {
    toast('Select a clip to apply a filter');
    return;
  }
  select(target.id);
  updateSelected({ filter: filterId });
}

export function applyFilterToAll(filterId: string) {
  edit((p) => ({
    ...p,
    clips: p.clips.map((c) => (c.kind === 'video' || c.kind === 'image' ? { ...c, filter: filterId } : c)),
  }));
}

export function applyTransition(kind: TransitionKind) {
  const s = get();
  let target = selectedClip(s);
  if (!target) {
    // Use the cut nearest the playhead on the main track.
    const main = getMainTrack(s.project);
    const clips = trackClips(s.project, main.id);
    let best: Clip | null = null;
    for (const c of clips.slice(1)) {
      if (!best || Math.abs(c.start - s.currentTime) < Math.abs(best.start - s.currentTime)) best = c;
    }
    target = best;
  }
  if (!target) {
    toast('Transitions go between two clips on the same track');
    return;
  }
  const prev = trackClips(s.project, target.trackId).find((c) => Math.abs(clipEnd(c) - target!.start) < 0.05);
  if (!prev && kind !== 'none') toast('Tip: transitions play where this clip meets the previous one');
  select(target.id);
  updateSelected((c) => ({ transition: kind, transitionDur: Math.min(c.transitionDur || 0.5, c.duration, prev?.duration ?? c.duration) }));
}

export function newProject(width: number, height: number) {
  engine.pause();
  revokeAll();
  openProject(createProject(width, height), {});
}

export async function openDraft(id: string) {
  engine.pause();
  const draft = await loadDraft(id);
  if (!draft) {
    toast('That draft could not be found');
    return;
  }
  revokeAll();
  openProject(draft.project, draft.assets);
  // Older drafts may be missing extras; rebuild lazily.
  for (const a of Object.values(draft.assets)) {
    if (a.kind === 'video' && !a.filmstrip?.length) {
      void buildFilmstrip(a).then((f) => patchAsset(a.id, { filmstrip: f }));
    }
  }
}

function revokeAll() {
  for (const a of Object.values(get().assets)) URL.revokeObjectURL(a.url);
}

export async function goHome() {
  engine.pause();
  await saveNow();
  useEditor.setState({ view: 'home', selectedId: null });
}

// ---------- autosave ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Project | null = null;
let lastSavedAssets: Record<string, Asset> | null = null;

export function captureThumbnail(): string | undefined {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-preview]');
  if (!canvas || canvas.width === 0) return undefined;
  const c = document.createElement('canvas');
  const scale = 240 / Math.max(canvas.width, canvas.height);
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

export async function saveNow() {
  const { project, assets, view } = get();
  if (view !== 'editor') return;
  if (project === lastSaved && assets === lastSavedAssets) return;
  // An untouched new project isn't worth a draft.
  if (project.clips.length === 0 && Object.keys(assets).length === 0) return;
  lastSaved = project;
  lastSavedAssets = assets;
  try {
    await saveProject(project, Object.values(assets), captureThumbnail());
  } catch (e) {
    console.warn('Autosave failed', e);
  }
}

export function startAutosave() {
  useEditor.subscribe((s, prev) => {
    if (s.view !== 'editor') return;
    if (s.project === prev.project && s.assets === prev.assets) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), 1200);
  });
  window.addEventListener('beforeunload', () => void saveNow());
}

export function renameProject(name: string) {
  edit((p) => ({ ...p, name: name.trim() || p.name }));
}
