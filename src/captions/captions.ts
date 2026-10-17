import { createTextClip } from '../model/factory';
import { addTrack, clipEnd, normalize } from '../model/ops';
import { FONTS } from '../model/presets';
import type { CaptionWord, Clip, Project, TextStyle } from '../model/types';

/** A recognised word with absolute timeline timestamps, in seconds. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionPreset {
  id: string;
  label: string;
  style: Partial<TextStyle>;
  highlight: string | null;
  /** Most words per caption. */
  maxWords: number;
  /** Most characters per line on a landscape canvas; portrait canvases get fewer. */
  maxChars: number;
  /** Vertical position as a fraction of canvas height from the centre. */
  y: number;
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    style: { fontSize: 60, color: '#ffffff', strokeColor: '#000000', strokeWidth: 8, shadow: true, bold: true },
    highlight: null,
    maxWords: 12,
    maxChars: 42,
    y: 0.34,
  },
  {
    id: 'box',
    label: 'Boxed',
    style: { fontSize: 54, color: '#ffffff', background: 'rgba(0,0,0,0.7)', strokeWidth: 0, shadow: false, bold: true },
    highlight: null,
    maxWords: 12,
    maxChars: 42,
    y: 0.36,
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    style: { fontSize: 72, color: '#ffffff', strokeColor: '#000000', strokeWidth: 10, shadow: true, bold: true },
    highlight: '#ffd400',
    maxWords: 6,
    maxChars: 26,
    y: 0.28,
  },
  {
    id: 'pop',
    label: 'Pop',
    style: { fontSize: 110, fontFamily: FONTS[1], color: '#ffffff', strokeColor: '#000000', strokeWidth: 12, shadow: true, bold: true },
    highlight: '#39ff14',
    maxWords: 2,
    maxChars: 16,
    y: 0.2,
  },
];

/** Gap in speech that always starts a new caption. */
const PAUSE = 0.7;
/** Longest a single caption stays on screen. */
const MAX_SPAN = 4;
/** Shortest a caption stays on screen. */
const MIN_SPAN = 0.4;

/** Cleans the raw recogniser output: trims, drops empties and bracketed non-speech like "[Music]". */
export function cleanWords(words: TimedWord[]): TimedWord[] {
  return words
    .map((w) => ({ ...w, text: w.text.trim() }))
    .filter((w) => w.text && !/^[[(].*[\])]$/.test(w.text) && w.end >= w.start)
    .sort((a, b) => a.start - b.start);
}

/** Splits a caption into at most two balanced lines. */
export function wrapLines(words: string[], maxChars: number): string {
  const full = words.join(' ');
  if (full.length <= maxChars || words.length < 2) return full;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const diff = Math.abs(a - b);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

/** Groups words into captions that break on pauses, sentence ends, length and duration. */
export function groupWords(input: TimedWord[], preset: CaptionPreset, portrait: boolean): TimedWord[][] {
  const words = cleanWords(input);
  const maxChars = Math.round(preset.maxChars * (portrait ? 0.6 : 1));
  const limit = maxChars * 2; // two lines
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const length = cur.map((x) => x.text).join(' ').length + 1 + w.text.length;
      if (
        w.start - prev.end > PAUSE ||
        cur.length >= preset.maxWords ||
        length > limit ||
        w.end - cur[0].start > MAX_SPAN ||
        /[.!?]$/.test(prev.text)
      ) {
        flush();
      }
    }
    cur.push(w);
  }
  flush();
  return groups;
}

/** Turns grouped words into caption clips with non-overlapping, gap-bridged timings. */
export function captionClips(groups: TimedWord[][], preset: CaptionPreset, portrait: boolean): Clip[] {
  const maxChars = Math.round(preset.maxChars * (portrait ? 0.6 : 1));
  const clips: Clip[] = [];
  groups.forEach((g, i) => {
    const start = Math.max(0, g[0].start);
    const next = groups[i + 1]?.[0].start ?? Infinity;
    let end = Math.max(g[g.length - 1].end, start + MIN_SPAN);
    // Bridge short gaps so captions don't flicker off between phrases.
    if (next - end < 0.3) end = next;
    end = Math.min(end, next);
    if (end - start < 0.05) return;
    const content = wrapLines(
      g.map((w) => w.text),
      maxChars,
    );
    const clip = createTextClip({ ...preset.style, content }, start);
    const words: CaptionWord[] = g.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start }));
    clips.push({
      ...clip,
      name: content.replace(/\n/g, ' ').slice(0, 40),
      duration: end - start,
      transform: { ...clip.transform, y: preset.y },
      caption: { words, highlight: preset.highlight },
    });
  });
  return clips;
}

const isPortrait = (p: Project) => p.settings.height > p.settings.width;

/** Replaces any existing caption track with new captions built from `words`. */
export function applyCaptions(p: Project, words: TimedWord[], preset: CaptionPreset): Project {
  const portrait = isPortrait(p);
  const clips = captionClips(groupWords(words, preset, portrait), preset, portrait);
  const old = new Set(p.tracks.filter((t) => t.captions).map((t) => t.id));
  let next: Project = { ...p, clips: p.clips.filter((c) => !old.has(c.trackId)) };
  next = normalize(next);
  if (!clips.length) return next;
  const res = addTrack(next, 'text');
  next = {
    ...res.project,
    tracks: res.project.tracks.map((t) => (t.id === res.track.id ? { ...t, captions: true } : t)),
  };
  return { ...next, clips: [...next.clips, ...clips.map((c) => ({ ...c, trackId: res.track.id }))] };
}

/** Absolute-time words recovered from the current caption clips (used to restyle). */
export function captionWords(p: Project): TimedWord[] {
  const tracks = new Set(p.tracks.filter((t) => t.captions).map((t) => t.id));
  const out: TimedWord[] = [];
  for (const c of p.clips) {
    if (!tracks.has(c.trackId) || !c.caption) continue;
    for (const w of c.caption.words) {
      // Convert from clip source time back to the timeline, keeping only words still inside the clip.
      const start = c.start + (w.start - c.inPoint) / c.speed;
      const end = c.start + (w.end - c.inPoint) / c.speed;
      if (end > c.start && start < clipEnd(c)) out.push({ text: w.text, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function hasCaptions(p: Project): boolean {
  return p.tracks.some((t) => t.captions && p.clips.some((c) => c.trackId === t.id));
}

export function removeCaptions(p: Project): Project {
  const ids = new Set(p.tracks.filter((t) => t.captions).map((t) => t.id));
  return normalize({ ...p, clips: p.clips.filter((c) => !ids.has(c.trackId)) });
}

/** Index of the word being spoken at clip source time `src`, or -1. */
export function activeWordIndex(words: CaptionWord[], src: number): number {
  for (let i = 0; i < words.length; i++) {
    const nextStart = words[i + 1]?.start ?? Infinity;
    if (src >= words[i].start && src < Math.max(words[i].end, Math.min(nextStart, words[i].end + 0.3))) return i;
  }
  return -1;
}
