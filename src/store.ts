import { create } from 'zustand';
import { createProject } from './model/factory';
import { normalize } from './model/ops';
import type { Asset, Project } from './model/types';

const HISTORY_LIMIT = 100;

export type LeftTab = 'media' | 'audio' | 'text' | 'captions' | 'stickers' | 'filters' | 'transitions';

export interface EditorState {
  view: 'home' | 'editor';
  project: Project;
  assets: Record<string, Asset>;
  selectedId: string | null;
  currentTime: number;
  playing: boolean;
  pxPerSec: number;
  snapping: boolean;
  leftTab: LeftTab;
  past: Project[];
  future: Project[];
  /** Project captured at the start of a drag so the whole gesture undoes as one step. */
  gestureBase: Project | null;
  importing: number;
  toast: { id: number; text: string } | null;
  /** A long-running job (reverse, cutout...) shown as a progress pill; progress null is indeterminate. */
  task: { label: string; progress: number | null; cancel?: () => void } | null;
  /** Preview click mode: sample a key colour or place a spotlight on the selected clip. */
  pick: 'chroma' | 'spotlight' | null;
  /** Voiceover recording in progress, started at this timeline time. */
  recording: { start: number } | null;
}

export const useEditor = create<EditorState>(() => ({
  view: 'home',
  project: createProject(),
  assets: {},
  selectedId: null,
  currentTime: 0,
  playing: false,
  pxPerSec: 60,
  snapping: true,
  leftTab: 'media',
  past: [],
  future: [],
  gestureBase: null,
  importing: 0,
  toast: null,
  task: null,
  pick: null,
  recording: null,
}));

const get = useEditor.getState;
const set = useEditor.setState;

/** Replace the project. Records an undo step unless a gesture is in progress or `history` is false. */
export function commit(next: Project, history = true): void {
  const { project, gestureBase, past } = get();
  if (next === project) return;
  next = { ...normalize(next), updatedAt: Date.now() };
  if (history && !gestureBase) {
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  } else {
    set({ project: next });
  }
  const sel = get().selectedId;
  if (sel && !next.clips.some((c) => c.id === sel)) set({ selectedId: null });
}

export function edit(fn: (p: Project) => Project | null | undefined, history = true): void {
  const next = fn(get().project);
  if (next) commit(next, history);
}

export function beginGesture(): void {
  set({ gestureBase: get().project });
}

export function endGesture(): void {
  const { gestureBase, project, past } = get();
  if (!gestureBase) return;
  if (gestureBase !== project) {
    set({ past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
  }
  set({ gestureBase: null });
}

export function undo(): void {
  const { past, project, future } = get();
  const prev = past[past.length - 1];
  if (!prev) return;
  set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
  fixSelection();
}

export function redo(): void {
  const { past, project, future } = get();
  const next = future[0];
  if (!next) return;
  set({ project: next, past: [...past, project], future: future.slice(1) });
  fixSelection();
}

function fixSelection() {
  const { selectedId, project } = get();
  if (selectedId && !project.clips.some((c) => c.id === selectedId)) set({ selectedId: null });
}

export function select(id: string | null): void {
  set({ selectedId: id });
}

export function addAsset(asset: Asset): void {
  set({ assets: { ...get().assets, [asset.id]: asset } });
}

export function patchAsset(id: string, patch: Partial<Asset>): void {
  const a = get().assets[id];
  if (a) set({ assets: { ...get().assets, [id]: { ...a, ...patch } } });
}

let toastSeq = 0;
export function toast(text: string): void {
  const id = ++toastSeq;
  set({ toast: { id, text } });
  setTimeout(() => {
    if (get().toast?.id === id) set({ toast: null });
  }, 2600);
}

export function openProject(project: Project, assets: Record<string, Asset>): void {
  set({
    view: 'editor',
    project,
    assets,
    selectedId: null,
    currentTime: 0,
    playing: false,
    past: [],
    future: [],
    gestureBase: null,
  });
}

export const selectedClip = (s: EditorState) => s.project.clips.find((c) => c.id === s.selectedId) ?? null;
