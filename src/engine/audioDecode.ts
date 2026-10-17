import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';

export interface DecodedAudio {
  sampleRate: number;
  /** One array per channel (a single one when `mono` was asked for). */
  channels: Float32Array[];
  /** Source time, in seconds, of the first sample. */
  start: number;
}

export interface DecodeOptions {
  /** Output rate. Lower rates are reached by averaging, which doubles as a simple low-pass. Default: the file's own rate. */
  sampleRate?: number;
  mono?: boolean;
  /** Source range in seconds. Defaults to the whole track. */
  start?: number;
  end?: number;
  signal?: AbortSignal;
  /** Above this size, don't fall back to decoding the whole file in memory. */
  maxFallbackBytes?: number;
  /** Stream even small files (tests). */
  forceStreaming?: boolean;
}

/**
 * Files up to this size are decoded whole with `decodeAudioData`, which is sample-exact for every
 * format (it trims MP3 encoder delay, for instance). Larger ones, long phone videos, are streamed.
 */
const STREAM_ABOVE = 96 * 1024 * 1024;

const aborted = () => new DOMException('Cancelled', 'AbortError');

/**
 * Decodes the audio of a media file. Large files stream only the audio track (and only the asked-for
 * range): long phone recordings are gigabytes, and reading one whole into memory, as `decodeAudioData`
 * needs, can crash a mobile browser tab. Falls back to `decodeAudioData` where WebCodecs can't decode
 * the track. Returns null when there is no audio.
 */
export async function decodeAudio(blob: Blob, opts: DecodeOptions = {}): Promise<DecodedAudio | null> {
  if (blob.size <= STREAM_ABOVE && !opts.forceStreaming) return decodeWhole(blob, opts);
  const streamed = await decodeStreaming(blob, opts);
  if (streamed !== undefined) return streamed;
  if (opts.maxFallbackBytes !== undefined && blob.size > opts.maxFallbackBytes) return null;
  return decodeWhole(blob, opts);
}

/** undefined means "couldn't stream this file, try the fallback". */
async function decodeStreaming(blob: Blob, opts: DecodeOptions): Promise<DecodedAudio | null | undefined> {
  if (typeof AudioDecoder === 'undefined') return undefined;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    let track;
    try {
      track = await input.getPrimaryAudioTrack();
    } catch {
      return undefined; // a container mediabunny doesn't read
    }
    if (!track) return null;
    if (!(await track.canDecode())) return undefined;
    const first = await track.getFirstTimestamp();
    const start = Math.max(0, opts.start ?? 0);
    const end = opts.end ?? (await track.computeDuration()) - first;
    if (!(end > start)) return null;
    const srcRate = track.sampleRate;
    const rate = Math.min(srcRate, opts.sampleRate ?? srcRate);
    const outChannels = opts.mono ? 1 : track.numberOfChannels;
    const length = Math.ceil((end - start) * rate);
    const out = Array.from({ length: outChannels }, () => new Float32Array(length));
    const sum = new Float64Array(outChannels);
    let count = 0;
    let at = -1; // output index being accumulated
    const flush = () => {
      if (at >= 0 && at < length && count) for (let c = 0; c < outChannels; c++) out[c][at] = sum[c] / count;
      sum.fill(0);
      count = 0;
    };

    let plane = new Float32Array(0);
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples(first + start, first + end)) {
      try {
        if (opts.signal?.aborted) throw aborted();
        const n = sample.numberOfFrames;
        const inCh = sample.numberOfChannels;
        if (plane.length < n * inCh) plane = new Float32Array(n * inCh);
        for (let c = 0; c < inCh; c++) sample.copyTo(plane.subarray(c * n, (c + 1) * n), { planeIndex: c, format: 'f32-planar' });
        // Position of this sample's first frame in output samples.
        const base = (sample.timestamp - first - start) * rate;
        const step = rate / sample.sampleRate;
        for (let i = 0; i < n; i++) {
          const j = Math.floor(base + i * step + 1e-4); // tolerate rounding in timestamps
          if (j !== at) {
            flush();
            at = j;
          }
          if (j < 0 || j >= length) continue;
          if (outChannels === 1) {
            let v = 0;
            for (let c = 0; c < inCh; c++) v += plane[c * n + i];
            sum[0] += v / inCh;
          } else {
            for (let c = 0; c < outChannels; c++) sum[c] += plane[Math.min(c, inCh - 1) * n + i];
          }
          count++;
        }
      } finally {
        sample.close();
      }
    }
    flush();
    return { sampleRate: rate, channels: out, start };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    console.warn('Streaming audio decode failed, decoding the whole file', e);
    return undefined;
  } finally {
    input.dispose();
  }
}

async function decodeWhole(blob: Blob, opts: DecodeOptions): Promise<DecodedAudio | null> {
  let buf: AudioBuffer;
  try {
    const ctx = new OfflineAudioContext(1, 1, opts.sampleRate ?? 48000);
    buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null; // no audio track, or a codec the browser can't decode
  }
  if (opts.signal?.aborted) throw aborted();
  const rate = buf.sampleRate;
  const a = Math.min(buf.length, Math.floor(Math.max(0, opts.start ?? 0) * rate));
  const b = Math.min(buf.length, opts.end === undefined ? buf.length : Math.ceil(opts.end * rate));
  if (b <= a) return null;
  const all = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice(a, b));
  let channels = all;
  if (opts.mono && all.length > 1) {
    const m = new Float32Array(b - a);
    for (const ch of all) for (let i = 0; i < m.length; i++) m[i] += ch[i] / all.length;
    channels = [m];
  }
  return { sampleRate: rate, channels, start: a / rate };
}

/** Packs decoded audio into an AudioBuffer for Web Audio. */
export function toAudioBuffer(d: DecodedAudio): AudioBuffer {
  const buf = new AudioBuffer({ length: Math.max(1, d.channels[0].length), numberOfChannels: d.channels.length, sampleRate: d.sampleRate });
  d.channels.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  return buf;
}
