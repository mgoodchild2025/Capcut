import { create } from 'zustand';
import { edit, toast, useEditor } from '../store';
import { applyCaptions, CAPTION_PRESETS, captionWords, removeCaptions } from './captions';
import type { TranscribeStage } from './transcribe';

interface CaptionState {
  running: boolean;
  stage: TranscribeStage | null;
  error: string | null;
  language: string;
  presetId: string;
  controller: AbortController | null;
}

/** Caption generation state lives outside the panel so it survives switching tabs mid-run. */
export const useCaptions = create<CaptionState>(() => ({
  running: false,
  stage: null,
  error: null,
  language: '',
  presetId: 'karaoke',
  controller: null,
}));

const presetById = (id: string) => CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];

export async function generateCaptions(): Promise<void> {
  if (useCaptions.getState().running) return;
  const controller = new AbortController();
  useCaptions.setState({ running: true, stage: { stage: 'audio' }, error: null, controller });
  try {
    // Loaded on demand: the speech recognition runtime is large.
    const { transcribe } = await import('./transcribe');
    const { project, assets } = useEditor.getState();
    const { language, presetId } = useCaptions.getState();
    const words = await transcribe(project, assets, {
      language,
      signal: controller.signal,
      onStage: (stage) => useCaptions.setState({ stage }),
    });
    if (!words.length) {
      useCaptions.setState({ error: 'No speech was found in the timeline audio.' });
      return;
    }
    edit((p) => applyCaptions(p, words, presetById(presetId)));
    toast(`Added captions`);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    console.error(err);
    const message = (err as Error).message || String(err);
    useCaptions.setState({
      error: /fetch|network|load/i.test(message)
        ? `Couldn't download the speech model. Check your connection and try again. (${message})`
        : message,
    });
  } finally {
    useCaptions.setState({ running: false, stage: null, controller: null });
  }
}

export function cancelCaptions(): void {
  useCaptions.getState().controller?.abort();
}

/** Applies a style to existing captions, regrouping the words to suit it. */
export function restyleCaptions(presetId: string): void {
  useCaptions.setState({ presetId });
  edit((p) => {
    const words = captionWords(p);
    return words.length ? applyCaptions(p, words, presetById(presetId)) : null;
  });
}

export function clearCaptions(): void {
  edit(removeCaptions);
}
