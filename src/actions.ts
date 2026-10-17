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
import { CURVE_PRESETS, removeKeyframe, setKeyframe, valueAt, hasKeyframeAt } from './model/timing';
import type { Asset, Clip, KeyProp, Project, Spotlight, TextStyle, TransitionKind } from './model/types';
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
