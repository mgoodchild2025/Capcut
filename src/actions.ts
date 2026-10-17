import { engine } from './engine/engine';
import { convertForPlayback } from './engine/convert';
import { buildFilmstrip, buildWaveform, importFile, UnplayableVideoError } from './engine/media';
import { deleteAssetRecord, loadDraft, saveAssetBlob, saveProject } from './engine/persist';
import { createMediaClip, createProject, createStickerClip, createTextClip } from './model/factory';
import {
  activeLayers,
  appendToMain,
  clipEnd,
  duplicateClip,
  getMainTrack,
  placeClip,
  projectDuration,
  removeClip,
  rippleDelete,
  splitClip,
  trackClips,
} from './model/ops';
import {
  addMarker,
  copyStyle,
  detachAudio,
  insertRipple,
  pasteStyle,
  removeMarker,
  replaceMedia,
  setCurve,
  setHold,
  type ClipStyle,
} from './model/ops';
import { CURVE_PRESETS, curveAverage, removeKeyframe, setKeyframe, valueAt, hasKeyframeAt } from './model/timing';
import type { Asset, Clip, KeyProp, Project, Spotlight, TextStyle, TransitionKind } from './model/types';
import { addAsset, commit, edit, openProject, patchAsset, select, selectedClip, toast, useEditor } from './store';

const get = useEditor.getState;

export async function importFiles(files: Iterable<File>): Promise<Asset[]> {
  const list = [...files];
  const imported: Asset[] = [];
  for (const file of list) {
    useEditor.setState((s) => ({ importing: s.importing + 1 }));
    try {
      const { asset, blob } = await importFile(file, undefined, { convert: convertWithProgress });
      addAsset(asset);
      imported.push(asset);
      const projectId = get().project.id;
      void saveAssetBlob(projectId, asset, blob).catch((e) => console.warn('Could not store media', e));
      void enrich(asset, blob);
    } catch (err) {
      console.error(err);
      const e = err as Error;
      if (e.name === 'AbortError') toast(`Import of ${file.name} canceled`);
      else if (e.name === 'UnplayableVideoError')
        toast(`Couldn't import ${file.name}: this browser can't decode its video. Try Safari or Chrome, or set iPhone Camera > Formats to Most Compatible.`);
      else toast(`Couldn't import ${file.name}`);
    } finally {
      useEditor.setState((s) => ({ importing: s.importing - 1 }));
    }
  }
  return imported;
}

/** Converts a video the browser can't play, showing progress (and a cancel button) in the preview. */
async function convertWithProgress(file: Blob, name: string): Promise<Blob> {
  const ac = new AbortController();
  const ownsTask = !get().task;
  const show = (progress: number | null, stage: string) => {
    if (!ownsTask) return;
    useEditor.setState({ task: { label: `${stage} ${name} for editing`, progress, cancel: () => ac.abort() } });
  };
  show(null, 'Preparing');
  try {
    return await convertForPlayback(file, name, show, ac.signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    console.warn('Conversion failed', e);
    throw new UnplayableVideoError(name);
  } finally {
    if (ownsTask) useEditor.setState({ task: null });
  }
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

/** Saves a draft as one `.clipforge` file: through the share sheet on phones (AirDrop, Files), a download elsewhere. */
export async function saveDraftToFile(id: string): Promise<void> {
  try {
    const { draftToFile } = await import('./engine/projectFile');
    const file = await draftToFile(id);
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        // Sharing can be refused (for example after a slow read); fall back to a download.
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast(`Saved ${file.name}`);
  } catch (e) {
    console.error(e);
    toast(`Couldn't save the project: ${(e as Error).message}`);
  }
}

/** Opens a `.clipforge` file as a new draft. */
export async function openProjectFile(file: File): Promise<boolean> {
  try {
    const { importProjectFile } = await import('./engine/projectFile');
    const id = await importProjectFile(file);
    await openDraft(id);
    toast('Project opened');
    return true;
  } catch (e) {
    console.error(e);
    toast((e as Error).name === 'ProjectFileError' ? (e as Error).message : `Couldn't open ${file.name}`);
    return false;
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


// ---------- long jobs ----------

async function runTask<T>(label: string, job: (report: (p: number | null) => void, signal: AbortSignal) => Promise<T>): Promise<T | null> {
  if (get().task) {
    toast('Another task is still running');
    return null;
  }
  const ac = new AbortController();
  useEditor.setState({ task: { label, progress: null, cancel: () => ac.abort() } });
  try {
    return await job((progress) => useEditor.setState((s) => (s.task ? { task: { ...s.task, progress } } : {})), ac.signal);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error(err);
      toast(`${label} failed: ${(err as Error).message}`);
    }
    return null;
  } finally {
    useEditor.setState({ task: null });
  }
}

async function importBlob(blob: Blob, name: string): Promise<Asset | null> {
  const file = new File([blob], name, { type: blob.type });
  const [asset] = await importFiles([file]);
  return asset ?? null;
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

// ---------- quick edits ----------

export function detachAudioSelected() {
  const sel = selectedClip(get());
  if (!sel || sel.kind !== 'video') return;
  const asset = sel.assetId ? get().assets[sel.assetId] : undefined;
  if (asset && asset.waveform && !asset.hasAudio) {
    toast('This clip has no audio');
    return;
  }
  edit((p) => detachAudio(p, sel.id));
  toast('Audio detached to its own track');
}

/** Inserts a 3-second still of the current frame at the playhead, pushing the rest along. */
export async function freezeFrameSelected() {
  const s = get();
  const sel = selectedClip(s);
  if (!sel || sel.kind !== 'video' || !sel.assetId) {
    toast('Select a video clip to freeze a frame');
    return;
  }
  const t = s.currentTime;
  if (t < sel.start || t > clipEnd(sel)) {
    toast('Move the playhead over the clip first');
    return;
  }
  const asset = s.assets[sel.assetId];
  await runTask('Freezing frame', async () => {
    const { captureFrame } = await import('./engine/frames');
    const { sourceTimeAt } = await import('./model/timing');
    const png = await captureFrame(asset, Math.min(sourceTimeAt(sel, t), asset.duration - 0.01));
    const still = await importBlob(png, `${baseName(asset.name)} freeze.png`);
    if (!still) return;
    const clip = { ...createMediaClip(still), duration: 3, transform: { ...sel.transform }, fit: sel.fit, filter: sel.filter, adjust: { ...sel.adjust }, crop: sel.crop, flipH: sel.flipH, flipV: sel.flipV };
    edit((p) => insertRipple(p, sel.trackId, t, clip));
    select(clip.id);
  });
}

/** Pans the selected clip to follow the action, for footage wider than the project frame. */
export async function autoReframeSelected() {
  const sel = selectedClip(get());
  if (!sel || sel.kind !== 'video' || !sel.assetId) {
    toast('Select a video clip to reframe');
    return;
  }
  const asset = get().assets[sel.assetId];
  const { width: W, height: H } = get().project.settings;
  const { needsReframe, trackAction } = await import('./ai/reframe');
  if (!needsReframe(asset, W, H)) {
    toast('This clip already fits the frame. Auto reframe is for wide footage in a taller project.');
    return;
  }
  await runTask('Following the action', async (_report, signal) => {
    const { sourceSpan } = await import('./model/timing');
    const { follow } = await import('./templates/shared');
    const path = await trackAction(asset, sel.inPoint, Math.min(asset.duration, sel.inPoint + sourceSpan(sel)), signal);
    const current = get().project.clips.find((c) => c.id === sel.id);
    if (!current) return;
    const next = follow({ ...current, keyframes: { ...current.keyframes, x: undefined } }, asset, W, H, path);
    edit((p) => ({ ...p, clips: p.clips.map((c) => (c.id === sel.id ? next : c)) }));
    toast('Reframed to follow the action. Undo to go back.');
  });
}

/** Replaces the clip's footage with a reversed copy of the section it uses. */
export async function reverseSelected() {
  const sel = selectedClip(get());
  if (!sel || sel.kind !== 'video' || !sel.assetId) {
    toast('Select a video clip to reverse');
    return;
  }
  const asset = get().assets[sel.assetId];
  const { sourceSpan } = await import('./model/timing');
  const from = sel.inPoint;
  const to = Math.min(asset.duration, sel.inPoint + sourceSpan(sel));
  if (to - from > 180) {
    toast('Reverse works on up to 3 minutes of footage; trim the clip first');
    return;
  }
  await runTask('Reversing clip', async (report, signal) => {
    const { reverseVideo } = await import('./engine/frames');
    const blob = await reverseVideo(asset, from, to, { onProgress: report, signal });
    const reversed = await importBlob(blob, `${baseName(asset.name)} reversed.mp4`);
    if (!reversed) return;
    edit((p) => updateClipById(replaceMedia(p, sel.id, reversed), sel.id, { inPoint: 0, duration: sel.duration }));
    toast('Clip reversed');
  });
}

function updateClipById(p: Project, id: string, patch: Partial<Clip>): Project {
  return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function replaceSelectedWith(assetId: string) {
  const sel = selectedClip(get());
  const asset = get().assets[assetId];
  if (!sel || !asset) return;
  const before = get().project;
  edit((p) => replaceMedia(p, sel.id, asset));
  if (get().project === before) toast("That media can't replace this clip");
  else toast('Clip replaced');
}

/** AI cutout for photo clips: swaps in a copy with the background removed. */
export async function removeBackgroundSelected() {
  const sel = selectedClip(get());
  if (!sel || sel.kind !== 'image' || !sel.assetId) {
    toast('Select a photo (or freeze frame) to remove its background');
    return;
  }
  const asset = get().assets[sel.assetId];
  await runTask('Removing background', async (report) => {
    const { removeBackground } = await import('./ai/cutout');
    const src = await (await fetch(asset.url)).blob();
    const png = await removeBackground(src, (l, t) => report(t ? (l / t) * 0.9 : null));
    const cut = await importBlob(png, `${baseName(asset.name)} cutout.png`);
    if (!cut) return;
    edit((p) => replaceMedia(p, sel.id, cut));
    toast('Background removed');
  });
}

let clipboardStyle: ClipStyle | null = null;

export function copySelectedStyle() {
  const sel = selectedClip(get());
  if (!sel) return;
  clipboardStyle = copyStyle(sel);
  toast('Style copied');
}

export function pasteSelectedStyle() {
  const sel = selectedClip(get());
  if (!sel || !clipboardStyle) {
    toast(clipboardStyle ? 'Select a clip to paste onto' : 'Copy a style first');
    return;
  }
  const style = clipboardStyle;
  edit((p) => pasteStyle(p, sel.id, style));
  toast('Style pasted');
}

export const hasCopiedStyle = () => !!clipboardStyle;

// ---------- markers ----------

export function addMarkerAtPlayhead(label = '') {
  edit((p) => addMarker(p, get().currentTime, label));
}

export function deleteMarker(id: string) {
  edit((p) => removeMarker(p, id));
}

// ---------- keyframes ----------

/** Clip-local playhead time, clamped into the clip. */
export function localPlayhead(clip: Clip): number {
  return Math.min(clip.duration, Math.max(0, get().currentTime - clip.start));
}

export function toggleKeyframe(prop: KeyProp) {
  const sel = selectedClip(get());
  if (!sel) return;
  const local = localPlayhead(sel);
  if (hasKeyframeAt(sel, prop, local)) {
    updateSelected((c) => ({ keyframes: removeKeyframe(c, prop, local) }));
  } else {
    updateSelected((c) => ({ keyframes: setKeyframe(c, prop, local, valueAt(c, prop, local)) }));
  }
}

/** Sets an animatable value: on a keyframed property this keys the playhead, otherwise it edits the base value. */
export function setAnimatable(prop: KeyProp, v: number, history = true) {
  updateSelected((c) => {
    if (c.keyframes?.[prop]?.length) return { keyframes: setKeyframe(c, prop, localPlayhead(c), v) };
    if (prop === 'volume') return { volume: v };
    return { transform: { ...c.transform, [prop]: v } };
  }, history);
}

// ---------- speed curve and spotlight ----------

export function setCurveSelected(presetId: string | null) {
  const sel = selectedClip(get());
  if (!sel) return;
  const preset = presetId ? CURVE_PRESETS.find((c) => c.id === presetId) : null;
  const asset = sel.assetId ? get().assets[sel.assetId] : undefined;
  edit((p) => setCurve(p, sel.id, preset ? { id: preset.id, points: preset.points.map((x) => ({ ...x })) } : undefined, asset));
}

export const DEFAULT_SPOTLIGHT: Spotlight = { x: 0.5, y: 0.5, r: 0.12, color: '#ffd400', label: '', zoom: true };

export function setSpotlightSelected(on: boolean, hold = 1.5) {
  const sel = selectedClip(get());
  if (!sel || sel.kind !== 'video') return;
  if (on) {
    edit((p) => updateClipById(setHold(p, sel.id, sel.hold || hold), sel.id, { spotlight: sel.spotlight ?? { ...DEFAULT_SPOTLIGHT } }));
    useEditor.setState({ pick: 'spotlight' });
    engineSeek(sel.start + 0.05);
  } else {
    edit((p) => updateClipById(setHold(p, sel.id, 0), sel.id, { spotlight: undefined }));
  }
}

export function setSpotlightHold(hold: number) {
  const sel = selectedClip(get());
  if (!sel) return;
  edit((p) => setHold(p, sel.id, hold));
}

function engineSeek(t: number) {
  engine.pause();
  engine.seek(t);
}

// ---------- music, sound effects, voiceover ----------

const soundCache = new Map<string, Promise<{ blob: Blob; beats?: number[]; bpm?: number }>>();

function renderSound(kind: 'music' | 'sfx', id: string, preview = false) {
  const key = `${kind}:${id}${preview ? ':preview' : ''}`;
  let p = soundCache.get(key);
  if (!p) {
    p = (async () => {
      const synth = await import('./audio/synth');
      const { encodeWav } = await import('./audio/wav');
      if (kind === 'music') {
        const track = synth.MUSIC.find((m) => m.id === id)!;
        const { buffer, beats } = await synth.renderMusic(track, preview ? 8 : Infinity);
        return { blob: encodeWav(buffer), beats, bpm: track.bpm };
      }
      const sfx = synth.SFX.find((x) => x.id === id)!;
      return { blob: encodeWav(await synth.renderSfx(sfx)) };
    })();
    p.catch(() => soundCache.delete(key));
    soundCache.set(key, p);
  }
  return p;
}

let previewAudio: HTMLAudioElement | null = null;
let previewKey: string | null = null;

/** Plays a library sound; calling again with the same sound stops it. Returns whether it is now playing. */
export async function togglePreviewSound(kind: 'music' | 'sfx', id: string): Promise<boolean> {
  const key = `${kind}:${id}`;
  if (previewAudio) {
    previewAudio.pause();
    URL.revokeObjectURL(previewAudio.src);
    previewAudio = null;
    if (previewKey === key) {
      previewKey = null;
      return false;
    }
  }
  previewKey = key;
  const { blob } = await renderSound(kind, id, kind === 'music');
  if (previewKey !== key) return false;
  const audio = new Audio(URL.createObjectURL(blob));
  previewAudio = audio;
  audio.onended = () => {
    if (previewAudio === audio) {
      previewAudio = null;
      previewKey = null;
    }
  };
  await audio.play().catch(() => {});
  // Someone previewing a track will probably add it: render the full version meanwhile.
  if (kind === 'music') void renderSound('music', id).catch(() => {});
  return true;
}

export function stopPreviewSound() {
  previewAudio?.pause();
  previewAudio = null;
  previewKey = null;
}

/** Adds a library music bed from the start of the project, trimmed and faded to fit the edit. */
export async function addMusic(id: string): Promise<void> {
  stopPreviewSound();
  await runTask('Preparing music', async () => {
    const { MUSIC } = await import('./audio/synth');
    const track = MUSIC.find((m) => m.id === id)!;
    const { blob, beats, bpm } = await renderSound('music', id);
    const asset = await importBlob(blob, `${track.title} (${track.bpm} BPM).wav`);
    if (!asset) return;
    patchAsset(asset.id, { beats, bpm });
    const clip = createMediaClip(asset);
    const length = projectDuration(get().project);
    if (length > 1 && length < clip.duration) {
      clip.duration = length;
      clip.audioFadeOut = Math.min(2, length / 4);
    }
    clip.volume = 0.8;
    edit((p) => placeClip(p, { ...clip, start: 0 }));
    select(clip.id);
    toast(`Added "${track.title}"`);
  });
}

export async function addSfx(id: string): Promise<void> {
  stopPreviewSound();
  const { SFX } = await import('./audio/synth');
  const sfx = SFX.find((x) => x.id === id)!;
  const { blob } = await renderSound('sfx', id);
  const asset = await importBlob(blob, `${sfx.title}.wav`);
  if (!asset) return;
  const clip = { ...createMediaClip(asset), start: get().currentTime };
  edit((p) => placeClip(p, clip));
  toast(`Added "${sfx.title}" at the playhead`);
}

/** Beat times on the timeline for an audio-bearing clip whose asset has beats. */
export function clipBeatsOnTimeline(clip: Clip): number[] {
  const asset = clip.assetId ? get().assets[clip.assetId] : undefined;
  if (!asset?.beats) return [];
  const out: number[] = [];
  const hold = clip.hold ?? 0;
  for (const b of asset.beats) {
    if (b < clip.inPoint) continue;
    const t = clip.start + hold + (b - clip.inPoint) / clip.speed;
    if (t > clipEnd(clip) + 1e-3) break;
    out.push(t);
  }
  return out;
}

/** Finds beats in the selected clip's audio (if not already known) and drops markers on them. */
export async function detectBeatsSelected(): Promise<number> {
  const sel = selectedClip(get());
  if (!sel || (sel.kind !== 'audio' && sel.kind !== 'video') || !sel.assetId) {
    toast('Select a music or video clip');
    return 0;
  }
  const asset = get().assets[sel.assetId];
  if (!asset.beats) {
    const res = await runTask('Finding beats', async () => {
      const { analyzeBeats } = await import('./audio/beats');
      return analyzeBeats(asset);
    });
    if (!res) return 0;
    patchAsset(asset.id, { beats: res.beats, bpm: res.bpm });
  }
  const clip = selectedClip(get())!;
  const times = clipBeatsOnTimeline(clip);
  // Mark the downbeat of every bar to keep the ruler readable.
  const bars = times.filter((_, i) => i % 4 === 0);
  edit((p) => {
    let next: Project = { ...p, markers: (p.markers ?? []).filter((m) => m.label !== 'beat') };
    for (const t of bars) next = addMarker(next, t, 'beat', '#00c2d1');
    return next;
  });
  toast(`${get().assets[asset.id].bpm ?? ''} BPM. Marked ${bars.length} bars`);
  return bars.length;
}

/** Re-times the main track so cuts land on the music's beats. */
export async function cutToBeat(beatsPerCut: number) {
  const s = get();
  let music = selectedClip(s);
  if (!music || (music.kind !== 'audio' && music.kind !== 'video') || !music.assetId || !s.assets[music.assetId]?.beats) {
    music = s.project.clips.find((c) => c.kind === 'audio' && c.assetId && s.assets[c.assetId]?.beats) ?? null;
  }
  if (!music) {
    toast('Add a music track and detect its beats first');
    return;
  }
  const beats = clipBeatsOnTimeline(music);
  const { cutToBeats } = await import('./audio/beats');
  edit((p) => cutToBeats(p, beats, beatsPerCut, get().assets));
  toast(`Cuts synced to every ${beatsPerCut === 1 ? 'beat' : `${beatsPerCut} beats`}`);
}

// Voiceover recording
let recorder: MediaRecorder | null = null;

export async function startVoiceover(): Promise<boolean> {
  if (recorder) return true;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    toast('Microphone access was blocked');
    return false;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const start = get().currentTime;
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    engine.setMonitorMuted(false);
    const type = rec.mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type });
    useEditor.setState({ recording: null });
    if (blob.size < 1000) return;
    const n = get().project.clips.filter((c) => /^Voiceover/.test(c.name)).length + 1;
    const asset = await importBlob(blob, `Voiceover ${n}.${type.includes('mp4') ? 'm4a' : 'webm'}`);
    if (!asset) return;
    const clip = { ...createMediaClip(asset), start, name: `Voiceover ${n}` };
    // The recorder may report an unknown length for streamed WebM; use the real elapsed time.
    if (!isFinite(clip.duration) || clip.duration <= 0.1) clip.duration = Math.max(0.5, get().currentTime - start);
    edit((p) => placeClip(p, clip));
    select(clip.id);
    toast('Voiceover added');
  };
  recorder = rec;
  engine.setMonitorMuted(true);
  rec.start(250);
  useEditor.setState({ recording: { start } });
  if (projectDuration(get().project) > start + 0.1) engine.play();
  return true;
}

export function stopVoiceover() {
  engine.pause();
  recorder?.stop();
  recorder = null;
}

// ---------- volleyball: highlights and reels ----------

export async function findHighlightsIn(assetId: string): Promise<void> {
  const asset = get().assets[assetId];
  if (!asset || asset.kind !== 'video') return;
  const res = await runTask('Finding highlights', async (report, signal) => {
    const { analyzeFootage } = await import('./ai/highlights');
    return analyzeFootage(asset, { onProgress: report, signal });
  });
  if (!res) return;
  const { useHighlights, highlightKey } = await import('./ai/highlightState');
  const st = useHighlights.getState();
  const top = res.slice(0, Math.min(6, res.length)).map((h, i) => highlightKey(h, i));
  useHighlights.setState({
    byAsset: { ...st.byAsset, [assetId]: res },
    selected: [...st.selected.filter((k) => !k.startsWith(`${assetId}:`)), ...top],
  });
  toast(res.length ? `Found ${res.length} highlight${res.length === 1 ? '' : 's'}` : 'No standout moments found in that clip');
}

/** Appends the selected highlights to the main track, optionally with a slow-motion Hero curve. */
export async function addHighlightsToTimeline(slowmo: boolean) {
  const { selectedHighlights } = await import('./ai/highlightState');
  const list = selectedHighlights();
  if (!list.length) {
    toast('Select some highlights first');
    return;
  }
  const hero = CURVE_PRESETS.find((c) => c.id === 'hero')!;
  edit((p) => {
    let next = p;
    for (const h of list.sort((a, b) => (a.assetId === b.assetId ? a.start - b.start : 0))) {
      const asset = get().assets[h.assetId];
      if (!asset) continue;
      let clip: Clip = { ...createMediaClip(asset), inPoint: h.start, duration: h.end - h.start };
      if (slowmo) {
        clip = { ...clip, curve: { id: 'hero', points: hero.points.map((x) => ({ ...x })) } };
        clip.duration = (h.end - h.start) / curveAverage(clip);
      }
      next = appendToMain(next, clip);
    }
    return next;
  });
  toast(`Added ${list.length} highlight${list.length === 1 ? '' : 's'}`);
}

export interface WizardResult {
  style: import('./templates/reel').ReelStyle;
  info: import('./templates/reel').ReelInfo;
  clips: import('./templates/reel').ReelClip[];
  musicId: string | null;
  /** Pan wide footage to follow the action in narrower reels. */
  follow?: boolean;
}

/** Generates cards and sound, then lays out the reel in the current project (undoable). */
export async function buildReelFromWizard(w: WizardResult): Promise<boolean> {
  const ok = await runTask('Building your reel', async (report) => {
    const { REEL_STYLES, buildReel } = await import('./templates/reel');
    const style = REEL_STYLES.find((s) => s.id === w.style)!;
    const [W, H] = style.aspect;
    const assetOf = (id?: string) => (id ? get().assets[id] : undefined);

    // Player photos and clips: the featured player, and the roster for team reels and the lineup.
    const roster = style.roster ? w.info.roster.filter((r) => (style.roster === 'intros' ? r.starter : true) && assetOf(r.assetId)) : [];
    const media: { key: string; assetId: string; cutout: boolean }[] = [
      ...(style.subject === 'player' && assetOf(w.info.photo) ? [{ key: 'photo', assetId: w.info.photo!, cutout: !!w.info.photoCutout }] : []),
      ...roster.map((r) => ({ key: r.key, assetId: r.assetId!, cutout: !!r.cutout })),
    ];
    const toCut = media.filter((m) => m.cutout && assetOf(m.assetId)?.kind === 'image');

    // Plays to auto-follow: wide footage going into a narrower frame, with no spotted player to centre on.
    const { needsReframe, trackAction } = await import('./ai/reframe');
    const toTrack = w.follow ? w.clips.map((c, i) => [c, i] as const).filter(([c]) => !c.spotlight && assetOf(c.assetId) && needsReframe(assetOf(c.assetId)!, W, H)) : [];
    let step = 0;
    const steps = 4 + toCut.length + toTrack.length + (w.musicId ? 1 : 0);

    const fromDataUrl = async (url: string | undefined, name: string) => (url ? importBlob(await (await fetch(url)).blob(), name) : null);
    const logo = await fromDataUrl(w.info.logo, 'Team logo.png');
    const oppLogo = await fromDataUrl(w.info.oppLogo, 'Opponent logo.png');
    report(++step / steps);

    // Cut players out of their photos (on-device model, downloaded once). If that isn't possible,
    // the photos are used as they are.
    const replaced = new Map<string, string>();
    let cutFailed = false;
    for (const m of toCut) {
      if (cutFailed) break;
      try {
        const { removeBackground } = await import('./ai/cutout');
        const src = assetOf(m.assetId)!;
        const png = await removeBackground(await (await fetch(src.url)).blob());
        const cut = await importBlob(png, `${baseName(src.name)} cutout.png`);
        if (cut) replaced.set(m.assetId, cut.id);
      } catch (e) {
        console.warn('Background removal failed', e);
        cutFailed = true;
        toast("Couldn't remove photo backgrounds right now (it needs a one-time download). Using the photos as they are.");
      }
      report(++step / steps);
    }
    const finalId = (id: string) => replaced.get(id) ?? id;
    const cutouts: string[] = [...replaced.values()];
    for (const m of media) {
      const a = assetOf(finalId(m.assetId));
      if (a?.kind === 'image' && !replaced.has(m.assetId) && (await hasTransparency(a.url))) cutouts.push(a.id);
    }

    // Living photos: a depth map for each still photo shown in a window (cut-outs already float).
    const depths: Record<string, string> = {};
    if (w.info.livePhotos !== false) {
      const { depthFor } = await import('./ai/depth');
      const stills = [...new Set(media.map((m) => finalId(m.assetId)))].filter((id) => assetOf(id)?.kind === 'image' && !cutouts.includes(id));
      let guessed = false;
      for (const id of stills) {
        const a = assetOf(id)!;
        try {
          const res = await depthFor(await (await fetch(a.url)).blob());
          guessed ||= res.guessed;
          const map = await importBlob(res.png, `${baseName(a.name)} depth.png`);
          if (map) {
            patchAsset(map.id, { internal: true });
            depths[id] = map.id;
          }
        } catch (e) {
          console.warn('No depth map', e);
        }
      }
      if (guessed) toast('Living photos are using a simpler 3D effect (the depth model needs a one-time download).');
    }

    let music: Asset | null = null;
    if (w.musicId) {
      const { MUSIC } = await import('./audio/synth');
      const track = MUSIC.find((m) => m.id === w.musicId)!;
      const { blob, beats, bpm } = await renderSound('music', w.musicId);
      music = await importBlob(blob, `${track.title} (${track.bpm} BPM).wav`);
      if (music) {
        patchAsset(music.id, { beats, bpm });
        music = get().assets[music.id];
      }
      report(++step / steps);
    }
    const sfx = async (id: string, name: string) => importBlob((await renderSound('sfx', id)).blob, name);
    const whoosh = await sfx('whoosh', 'Whoosh.wav');
    report(++step / steps);
    const impact = await sfx('impact', 'Impact.wav');
    report(++step / steps);

    const clips = w.clips.slice();
    for (const [c, i] of toTrack) {
      try {
        clips[i] = { ...c, track: await trackAction(assetOf(c.assetId)!, c.inPoint, c.inPoint + c.duration) };
      } catch (e) {
        console.warn('Could not track', e);
      }
      report(++step / steps);
    }

    const photo = media.find((m) => m.key === 'photo');
    const built = buildReel(
      {
        style: w.style,
        info: w.info,
        clips,
        cards: {
          music: music?.id,
          whoosh: whoosh?.id,
          impact: impact?.id,
          logo: logo?.id,
          oppLogo: oppLogo?.id,
          photo: photo ? finalId(photo.assetId) : undefined,
          players: Object.fromEntries(media.filter((m) => m.key !== 'photo').map((m) => [m.key, finalId(m.assetId)])),
          cutouts,
          depths,
        },
      },
      get().assets,
    );
    const current = get().project;
    commit({ ...built, id: current.id, createdAt: current.createdAt });
    engine.pause();
    // Land on the finished title rather than its first, still-animating frame.
    engine.seek(2.2);
    select(null);
    return true;
  });
  if (ok) toast('Your reel is ready. Press play!');
  return !!ok;
}

/** True when an image has see-through areas (a cut-out player rather than a photo). */
async function hasTransparency(url: string): Promise<boolean> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++;
    return clear > 48 * 48 * 0.08;
  } catch {
    return false;
  }
}

/** AI voiceover: speaks the text on-device and drops it at the playhead. */
export async function generateSpeech(text: string, voice: string): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  const res = await runTask('Generating voice', async (report) => {
    const { synthesizeSpeech } = await import('./ai/tts');
    const wav = await synthesizeSpeech(clean, voice, report);
    const words = clean.split(/\s+/).slice(0, 4).join(' ');
    const asset = await importBlob(wav, `Voice - ${words}.wav`);
    if (!asset) return false;
    const clip = { ...createMediaClip(asset), start: get().currentTime, name: `Voice: ${words}` };
    edit((p) => placeClip(p, clip));
    select(clip.id);
    return true;
  });
  if (res) toast('Voiceover added at the playhead');
  return !!res;
}
