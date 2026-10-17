/// <reference lib="webworker" />
import { env, pipeline, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL = 'onnx-community/depth-anything-v2-small';
type Estimator = (image: RawImage) => Promise<{ depth: RawImage }>;
let estimator: Promise<Estimator> | null = null;

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent) => {
  const { id, data, width, height } = e.data as { id: number; data: Uint8ClampedArray; width: number; height: number };
  try {
    estimator ??= pipeline('depth-estimation', MODEL, {
      dtype: 'q8',
      progress_callback: (p: unknown) => post({ type: 'progress', data: p }),
    }) as unknown as Promise<Estimator>;
    const run = await estimator;
    const { depth } = await run(new RawImage(data, width, height, 4));
    const grey = depth.channels === 1 ? depth : depth.grayscale();
    const pixels = new Uint8ClampedArray(grey.data);
    post({ type: 'result', id, data: pixels, width: grey.width, height: grey.height }, [pixels.buffer]);
  } catch (err) {
    estimator = null;
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
