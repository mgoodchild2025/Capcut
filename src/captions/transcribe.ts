import { mixAudio } from '../engine/mix';
import type { Asset, Project } from '../model/types';
import type { TimedWord } from './captions';
import { isSilent, splitWindows } from './windows';

export const CAPTION_MODEL = 'onnx-community/whisper-base_timestamped';
const SAMPLE_RATE = 16000;


export type TranscribeStage =
  | { stage: 'audio' }
  | { stage: 'download'; progress: number; loaded: number; total: number }
  | { stage: 'transcribe'; progress: number; device?: string };

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let device: string | undefined;
let seq = 0;
const pending = new Map<number, Pending>();
let onLoadProgress: ((p: unknown) => void) | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      onLoadProgress?.(msg.data);
      return;
    }
    if (msg.type === 'ready') device = msg.device;
    const p = pending.get(msg.id ?? -1) ?? pending.get(-1);
    if (!p) return;
    pending.delete(msg.id ?? -1);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Speech recognition failed to start.'));
    pending.clear();
    resetWorker();
  };
  return worker;
}

function resetWorker() {
  worker?.terminate();
  worker = null;
  device = undefined;
}

function call<T>(msg: Record<string, unknown>, id: number, transfer: Transferable[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

/** Sums download progress across the model's files. */
function downloadTracker(report: (s: TranscribeStage) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (data: unknown) => {
    const d = data as { status?: string; file?: string; loaded?: number; total?: number };
    if (d.status !== 'progress' || !d.file) return;
    files.set(d.file, { loaded: d.loaded ?? 0, total: d.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    report({ stage: 'download', loaded, total, progress: total ? loaded / total : 0 });
  };
}

/**
 * Transcribes everything audible on the timeline and returns words with timeline timestamps.
 * The first run downloads the speech model (cached by the browser afterwards).
 */
export async function transcribe(
  project: Project,
  assets: Record<string, Asset>,
  opts: { language: string; onStage: (s: TranscribeStage) => void; signal: AbortSignal },
): Promise<TimedWord[]> {
  const abort = () => {
    for (const p of pending.values()) p.reject(new DOMException('Cancelled', 'AbortError'));
    pending.clear();
    resetWorker();
  };
  opts.signal.addEventListener('abort', abort);
  try {
    opts.onStage({ stage: 'audio' });
    const mix = await mixAudio(project, assets, { sampleRate: SAMPLE_RATE, channels: 1, signal: opts.signal });
    if (!mix) return [];
    const samples = mix.getChannelData(0);

    onLoadProgress = downloadTracker(opts.onStage);
    await call({ type: 'load', model: CAPTION_MODEL }, -1);
    onLoadProgress = null;

    const windows = splitWindows(samples, SAMPLE_RATE);
    const words: TimedWord[] = [];
    for (let i = 0; i < windows.length; i++) {
      opts.onStage({ stage: 'transcribe', progress: i / windows.length, device });
      const [a, b] = windows[i];
      const chunk = samples.slice(a, b);
      if (isSilent(chunk)) continue;
      const offset = a / SAMPLE_RATE;
      const windowEnd = b / SAMPLE_RATE;
      const res = await call<{ chunks: { text: string; timestamp: [number, number | null] }[] }>(
        { type: 'run', model: CAPTION_MODEL, audio: chunk, language: opts.language },
        ++seq,
        [chunk.buffer],
      );
      for (const c of res.chunks) {
        const start = offset + c.timestamp[0];
        const end = c.timestamp[1] === null ? windowEnd : offset + c.timestamp[1];
        words.push({ text: c.text, start, end: Math.min(end, windowEnd) });
      }
    }
    opts.onStage({ stage: 'transcribe', progress: 1, device });
    return words;
  } finally {
    onLoadProgress = null;
    opts.signal.removeEventListener('abort', abort);
  }
}
