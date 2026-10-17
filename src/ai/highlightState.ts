import { create } from 'zustand';
import type { FoundHighlight } from './highlights';

interface HighlightState {
  /** Results per analysed video asset. */
  byAsset: Record<string, FoundHighlight[]>;
  /** Selected highlights as "assetId:index". */
  selected: string[];
}

export const useHighlights = create<HighlightState>(() => ({ byAsset: {}, selected: [] }));

export const highlightKey = (h: FoundHighlight, i: number) => `${h.assetId}:${i}`;

export function toggleHighlight(key: string) {
  const { selected } = useHighlights.getState();
  useHighlights.setState({ selected: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key] });
}

export function selectedHighlights(): FoundHighlight[] {
  const { byAsset, selected } = useHighlights.getState();
  return selected
    .map((k) => {
      const [assetId, i] = k.split(':');
      return byAsset[assetId]?.[Number(i)];
    })
    .filter((h): h is FoundHighlight => !!h);
}
