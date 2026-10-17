import { encodeWav } from '../audio/wav';

export const TTS_VOICES = [
  { id: 'natural', label: 'Natural (Supertonic)' },
  { id: 'classic', label: 'Classic (MMS)' },
];

let worker: Worker | null = null;
let seq = 0;

/** Speaks `text` on-device and returns a WAV file. The first use downloads the voice model. */
export async function synthesizeSpeech(text: string, voice: string, onProgress?: (p: number | null) => void): Promise<Blob> {
  worker ??= new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const files = new Map<string, [number, number]>();
  const { audio, rate } = await new Promise<{ audio: Float32Array; rate: number }>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') {
        const d = msg.data as { status?: string; file?: string; loaded?: number; total?: number };
        if (d.status === 'progress' && d.file) {
          files.set(d.file, [d.loaded ?? 0, d.total ?? 0]);
          let l = 0;
          let t = 0;
          for (const [a, b] of files.values()) {
            l += a;
            t += b;
          }
          onProgress?.(t ? (l / t) * 0.9 : null);
        }
        return;
      }
      worker!.removeEventListener('message', onMessage);
      if (msg.type === 'error') reject(new Error(msg.message));
      else resolve(msg);
    };
    worker!.addEventListener('message', onMessage);
    worker!.onerror = (e) => {
      worker = null;
      reject(new Error(e.message || 'Speech synthesis failed to start.'));
    };
    worker!.postMessage({ id, text, voice });
  });
  const buffer = new AudioBuffer({ length: audio.length, numberOfChannels: 1, sampleRate: rate });
  buffer.copyToChannel(new Float32Array(audio), 0);
  return encodeWav(buffer);
}
