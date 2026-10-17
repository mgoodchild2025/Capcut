/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';

// Models come from the Hugging Face Hub and are cached by the browser after the first download.
env.allowLocalModels = false;

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

let loaded: { model: string; run: Transcriber; device: string } | null = null;

const post = (msg: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(model: string) {
  if (loaded?.model === model) return loaded;
  const device = (await webgpuAvailable()) ? 'webgpu' : 'wasm';
  const run = (await pipeline('automatic-speech-recognition', model, {
    device,
    // fp32 encoder keeps word timings accurate; the decoder tolerates heavy quantisation.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: unknown) => post({ type: 'progress', data: p }),
  })) as unknown as Transcriber;
  loaded = { model, run, device };
  return loaded;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      const { device } = await load(msg.model);
      post({ type: 'ready', device });
    } else if (msg.type === 'run') {
      const { run } = await load(msg.model);
      const out = await run(msg.audio, {
        return_timestamps: 'word',
        language: msg.language || null,
        task: 'transcribe',
      });
      post({ type: 'result', id: msg.id, chunks: out.chunks ?? [] });
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
