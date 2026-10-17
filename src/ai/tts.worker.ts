/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

type Synth = (text: string, options?: Record<string, unknown>) => Promise<{ audio: Float32Array; sampling_rate: number }>;
const loaded = new Map<string, Promise<Synth>>();
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

const VOICES: Record<string, { model: string; options?: Record<string, unknown> }> = {
  natural: {
    model: 'onnx-community/Supertonic-TTS-ONNX',
    options: { speaker_embeddings: 'https://huggingface.co/onnx-community/Supertonic-TTS-ONNX/resolve/main/voices/F1.bin' },
  },
  classic: { model: 'Xenova/mms-tts-eng' },
};

self.onmessage = async (e: MessageEvent) => {
  const { id, text, voice } = e.data as { id: number; text: string; voice: string };
  try {
    const v = VOICES[voice] ?? VOICES.natural;
    let synth = loaded.get(v.model);
    if (!synth) {
      synth = pipeline('text-to-speech', v.model, {
        progress_callback: (p: unknown) => post({ type: 'progress', id, data: p }),
      }) as unknown as Promise<Synth>;
      loaded.set(v.model, synth);
    }
    const run = await synth;
    const out = await run(text, v.options);
    const audio = new Float32Array(out.audio);
    post({ type: 'result', id, audio, rate: out.sampling_rate }, [audio.buffer]);
  } catch (err) {
    loaded.clear();
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
