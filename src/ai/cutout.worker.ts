/// <reference lib="webworker" />
import { env, pipeline, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL = 'Xenova/modnet';
type Segmenter = (image: RawImage) => Promise<RawImage>;
let segmenter: Promise<Segmenter> | null = null;

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent) => {
  const { id, data, width, height } = e.data as { id: number; data: Uint8ClampedArray; width: number; height: number };
  try {
    segmenter ??= pipeline('background-removal', MODEL, {
      dtype: 'fp32',
      progress_callback: (p: unknown) => post({ type: 'progress', data: p }),
    }) as unknown as Promise<Segmenter>;
    const run = await segmenter;
    const out = await run(new RawImage(data, width, height, 4));
    const rgba = out.channels === 4 ? out : out.rgba();
    const pixels = new Uint8ClampedArray(rgba.data);
    post({ type: 'result', id, data: pixels, width: rgba.width, height: rgba.height }, [pixels.buffer]);
  } catch (err) {
    segmenter = null;
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
