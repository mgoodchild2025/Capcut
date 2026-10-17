import { describe, expect, it } from 'vitest';
import { createProject } from '../model/factory';
import { splitClip } from '../model/ops';
import {
  activeWordIndex,
  applyCaptions,
  CAPTION_PRESETS,
  captionWords,
  cleanWords,
  groupWords,
  hasCaptions,
  removeCaptions,
  wrapLines,
  type TimedWord,
} from './captions';

const classic = CAPTION_PRESETS.find((p) => p.id === 'classic')!;
const pop = CAPTION_PRESETS.find((p) => p.id === 'pop')!;

/** Words spoken at a steady 0.4s each starting at `t0`. */
function speak(sentence: string, t0 = 0): TimedWord[] {
  return sentence.split(' ').map((text, i) => ({ text: ` ${text}`, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.35 }));
}

describe('captions', () => {
  it('cleans recogniser output', () => {
    const out = cleanWords([
      { text: ' [Music]', start: 0, end: 1 },
      { text: ' hello', start: 1, end: 1.3 },
      { text: '  ', start: 1.3, end: 1.4 },
    ]);
    expect(out).toEqual([{ text: 'hello', start: 1, end: 1.3 }]);
  });

  it('wraps long captions into two balanced lines', () => {
    expect(wrapLines(['short'], 10)).toBe('short');
    expect(wrapLines('one two three four five six'.split(' '), 12)).toBe('one two three\nfour five six');
  });

  it('breaks on sentence ends and pauses', () => {
    const words = [...speak('Hello there friend.', 0), ...speak('How are you', 1.2), ...speak('today', 5)];
    const groups = groupWords(words, classic, false);
    expect(groups.map((g) => g.map((w) => w.text).join(' '))).toEqual(['Hello there friend.', 'How are you', 'today']);
  });

  it('respects the word limit of punchy presets', () => {
    const groups = groupWords(speak('one two three four five'), pop, true);
    expect(groups.map((g) => g.length)).toEqual([2, 2, 1]);
  });

  it('never runs a caption across a sentence end', () => {
    const groups = groupWords(speak('to the channel. Today we'), pop, true);
    expect(groups.map((g) => g.map((w) => w.text).join(' '))).toEqual(['to the', 'channel.', 'Today we']);
  });

  it('builds a caption track and replaces it on regeneration', () => {
    let p = createProject();
    p = applyCaptions(p, speak('the quick brown fox jumps.'), classic);
    expect(hasCaptions(p)).toBe(true);
    const track = p.tracks.find((t) => t.captions)!;
    const clips = p.clips.filter((c) => c.trackId === track.id);
    expect(clips).toHaveLength(1);
    expect(clips[0].text!.content).toBe('the quick brown fox jumps.');
    expect(clips[0].caption!.words[1]).toEqual({ text: 'quick', start: 0.4, end: 0.75 });

    p = applyCaptions(p, speak('again'), classic);
    expect(p.tracks.filter((t) => t.captions)).toHaveLength(1);
    expect(p.clips).toHaveLength(1);
    expect(removeCaptions(p).clips).toHaveLength(0);
  });

  it('keeps caption clips from overlapping', () => {
    const p = applyCaptions(createProject(), [...speak('a b.'), ...speak('c d', 0.85)], classic);
    const [a, b] = [...p.clips].sort((x, y) => x.start - y.start);
    expect(a.start + a.duration).toBeLessThanOrEqual(b.start + 1e-9);
  });

  it('recovers absolute word times after a split', () => {
    let p = applyCaptions(createProject(), speak('one two three four'), classic);
    const words = captionWords(p);
    p = splitClip(p, p.clips[0].id, 0.8, 'right')!;
    const again = captionWords(p);
    expect(again.map((w) => w.text)).toEqual(words.map((w) => w.text));
    expect(again.map((w) => w.start)).toEqual(words.map((w) => w.start));
  });

  it('finds the active word, bridging short gaps', () => {
    const words = [
      { text: 'a', start: 0, end: 0.3 },
      { text: 'b', start: 0.4, end: 0.7 },
    ];
    expect(activeWordIndex(words, 0.1)).toBe(0);
    expect(activeWordIndex(words, 0.35)).toBe(0);
    expect(activeWordIndex(words, 0.5)).toBe(1);
    expect(activeWordIndex(words, 2)).toBe(-1);
  });
});
