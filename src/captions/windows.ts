/** Whisper reads at most 30 seconds at a time; windows stay under that with room to spare. */
export const MAX_WINDOW = 28;
/** Earliest point in a window at which we look for a quiet place to cut. */
const SEARCH_FROM = 22;
const FRAME = 0.05;

/**
 * Splits audio into windows of at most MAX_WINDOW seconds, cutting at the quietest
 * 50ms frame in the last few seconds of each window so words are rarely sliced in half.
 * Returns [startSample, endSample) pairs.
 */
export function splitWindows(samples: Float32Array, sampleRate: number): [number, number][] {
  const total = samples.length;
  const max = Math.floor(MAX_WINDOW * sampleRate);
  const frame = Math.max(1, Math.floor(FRAME * sampleRate));
  const windows: [number, number][] = [];
  let start = 0;
  while (start < total) {
    if (total - start <= max) {
      windows.push([start, total]);
      break;
    }
    let cut = start + max;
    let quietest = Infinity;
    for (let f = start + Math.floor(SEARCH_FROM * sampleRate); f + frame <= start + max; f += frame) {
      let energy = 0;
      for (let i = f; i < f + frame; i++) energy += samples[i] * samples[i];
      if (energy < quietest) {
        quietest = energy;
        cut = f + Math.floor(frame / 2);
      }
    }
    windows.push([start, cut]);
    start = cut;
  }
  return windows;
}

/** True when a stretch of audio is effectively silent (no point asking the model). */
export function isSilent(samples: Float32Array, threshold = 0.004): boolean {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 8) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length / 8)) < threshold;
}
