import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from 'mediabunny';

/** Longest edge of a converted video. Plenty for editing and keeps conversion quick. */
const MAX_EDGE = 1920;
const WASM_MAX_EDGE = 1280;

export type ConvertProgress = (p: number | null, stage: string) => void;

const abortError = () => new DOMException('Conversion canceled', 'AbortError');

/** True when this browser's `<video>` element can play H.264 in MP4. */
export function playsH264(): boolean {
  return document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== '';
}

/**
 * Re-encodes a video this browser can't play (typically HEVC from an iPhone) into one it can.
 * Tries hardware decoding through WebCodecs first and falls back to ffmpeg compiled to WebAssembly,
 * which is slower but decodes almost anything.
 */
export async function convertForPlayback(file: Blob, name: string, onProgress: ConvertProgress, signal: AbortSignal): Promise<Blob> {
  const fast = await convertWithWebCodecs(file, onProgress, signal);
  if (fast) return fast;
  return convertWithFfmpeg(file, name, onProgress, signal);
}

async function convertWithWebCodecs(file: Blob, onProgress: ConvertProgress, signal: AbortSignal): Promise<Blob | null> {
  if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') return null;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track || !(await track.canDecode())) return null;
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    const w = await track.getDisplayWidth();
    const h = await track.getDisplayHeight();
    const k = Math.min(1, MAX_EDGE / Math.max(w, h));
    const width = Math.round((w * k) / 2) * 2;
    const height = Math.round((h * k) / 2) * 2;

    const mp4 = playsH264();
    const format = mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const videoCodec = await getFirstEncodableVideoCodec(mp4 ? ['avc'] : ['vp9', 'vp8'], { width, height });
    if (!videoCodec) return null;
    const audioCodec = audioTrack ? await getFirstEncodableAudioCodec(mp4 ? ['aac'] : ['opus']) : null;

    const output = new Output({ format, target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { codec: videoCodec, width, height, fit: 'fill', allowRotationMetadata: false, bitrate: QUALITY_HIGH, forceTranscode: true },
      audio: audioCodec ? { codec: audioCodec } : { discard: true },
    });
    if (!conversion.isValid) return null;
    const stop = () => void conversion.cancel();
    signal.addEventListener('abort', stop);
    conversion.onProgress = (p) => onProgress(p, 'Converting');
    try {
      await conversion.execute();
    } catch (e) {
      if (signal.aborted) throw abortError();
      console.warn('WebCodecs conversion failed, trying ffmpeg', e);
      return null;
    } finally {
      signal.removeEventListener('abort', stop);
    }
    const buffer = (output.target as BufferTarget).buffer;
    return buffer ? new Blob([buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }) : null;
  } finally {
    input.dispose();
  }
}

async function convertWithFfmpeg(file: Blob, name: string, onProgress: ConvertProgress, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw abortError();
  onProgress(null, 'Loading converter');
  const [{ FFmpeg, FFFSType }, { default: coreUrl }, { default: wasmUrl }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/core?url'),
    import('@ffmpeg/core/wasm?url'),
  ]);
  const ffmpeg = new FFmpeg();
  const stop = () => ffmpeg.terminate();
  signal.addEventListener('abort', stop);
  try {
    await ffmpeg.load({
      coreURL: new URL(coreUrl, document.baseURI).href,
      wasmURL: new URL(wasmUrl, document.baseURI).href,
    });
    ffmpeg.on('progress', ({ progress }) => onProgress(Math.min(1, Math.max(0, progress)), 'Converting'));
    onProgress(0, 'Converting');

    // Mount the file instead of copying it into memory, so large clips fit.
    const ext = (name.split('.').pop() ?? 'mov').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mov';
    const inName = `input.${ext}`;
    await ffmpeg.createDir('/in');
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [new File([file], inName)] }, '/in');

    const mp4 = playsH264();
    const out = mp4 ? 'out.mp4' : 'out.webm';
    const scale = `scale='if(gte(iw,ih),min(${WASM_MAX_EDGE},iw),-2)':'if(gte(iw,ih),-2,min(${WASM_MAX_EDGE},ih))',fps=30,format=yuv420p`;
    const video = mp4
      ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-movflags', '+faststart']
      : ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '4M', '-qmin', '4', '-qmax', '42'];
    // Vorbis rather than Opus: this ffmpeg build's libopus crashes on stereo input.
    const audio = mp4 ? ['-c:a', 'aac', '-b:a', '160k'] : ['-c:a', 'libvorbis', '-q:a', '5'];
    const code = await ffmpeg.exec(['-i', `/in/${inName}`, '-map', '0:v:0', '-map', '0:a:0?', '-vf', scale, ...video, ...audio, out]);
    if (signal.aborted) throw abortError();
    if (code !== 0) throw new Error(`The converter couldn't read ${name}.`);
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: mp4 ? 'video/mp4' : 'video/webm' });
  } catch (e) {
    if (signal.aborted) throw abortError();
    throw e;
  } finally {
    signal.removeEventListener('abort', stop);
    if (!signal.aborted) ffmpeg.terminate();
  }
}
