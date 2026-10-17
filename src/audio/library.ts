/**
 * Recorded music and sound effects bundled with the app. Every file is CC0 (public domain
 * dedication by its creator), so reels made with them can be posted anywhere. Files are
 * mastered to the same loudness (-12 LUFS for music) and fetched on first use, then cached for
 * offline use by the service worker.
 */
import BEATS from './libraryBeats.json';

export interface LibraryTrack {
  id: string;
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  seconds: number;
  /** Accent colours for the library card. */
  colors: [string, string];
  /** Beat times in seconds (from the app's beat detector, checked against the drum hits). */
  beats: number[];
  /** Where it came from, for the credits. */
  source: string;
}

export interface LibrarySfx {
  id: string;
  title: string;
  /** Where the sound peaks, so it can be lined up with a cut. */
  peak?: number;
  source: string;
}

const beatsOf = (id: keyof typeof BEATS) => BEATS[id];

const track = (id: keyof typeof BEATS, t: Omit<LibraryTrack, 'id' | 'bpm' | 'seconds' | 'beats'>): LibraryTrack => ({
  id,
  ...t,
  bpm: beatsOf(id).bpm,
  seconds: beatsOf(id).seconds,
  beats: beatsOf(id).beats,
});

const OGA = 'https://opengameart.org/content/';

export const LIBRARY_MUSIC: LibraryTrack[] = [
  track('lucid-trigger', { title: 'Lucid Trigger', artist: 'Liq_mmry', mood: 'Progressive breaks', colors: ['#7c3aed', '#ec4899'], source: `${OGA}lucid-trigger` }),
  track('hyper-ultra-racing', { title: 'Hyper Ultra-Racing', artist: 'cynicmusic', mood: 'Cinematic drum & bass', colors: ['#0ea5e9', '#22d3ee'], source: `${OGA}hyper-ultra-racing` }),
  track('doomed', { title: 'Doomed', artist: 'Alexander Ehlers', mood: 'Heavy rock', colors: ['#991b1b', '#f97316'], source: `${OGA}free-music-pack` }),
  track('warped', { title: 'Warped', artist: 'Alexander Ehlers', mood: 'Electro rock', colors: ['#f43f5e', '#fbbf24'], source: `${OGA}free-music-pack` }),
  track('determined-pursuit', { title: 'Determined Pursuit', artist: 'Emma_MA', mood: 'Epic orchestral', colors: ['#1e3a8a', '#94a3b8'], source: `${OGA}determined-pursuit-epic-orchestra-loop` }),
  track('great-mission', { title: 'Great Mission', artist: 'Alexander Ehlers', mood: 'Cinematic orchestral', colors: ['#334155', '#eab308'], source: `${OGA}free-music-pack` }),
  track('rhythm-factory', { title: 'Rhythm Factory', artist: 'Zane Little Music', mood: 'Funky, upbeat', colors: ['#f59e0b', '#84cc16'], source: `${OGA}rhythm-factory` }),
  track('funked-up', { title: 'Funked Up', artist: 'Joth', mood: 'Groovy funk rock', colors: ['#14b8a6', '#a3e635'], source: `${OGA}funked-up` }),
];

export const LIBRARY_SFX: LibrarySfx[] = [
  { id: 'whoosh', title: 'Whoosh', peak: 0.34, source: `${OGA}wierd-whooshes` },
  { id: 'impact', title: 'Slam', source: 'https://kenney.nl/assets/impact-sounds' },
  { id: 'crowd', title: 'Crowd cheer', source: `${OGA}applause-in-a-large-hall-or-church` },
  { id: 'punch', title: 'Hit', source: 'https://kenney.nl/assets/impact-sounds' },
  { id: 'boom', title: 'Boom', source: 'https://kenney.nl/assets/sci-fi-sounds' },
  { id: 'swish', title: 'Swish', source: `${OGA}swishes-sound-pack` },
];

export const libraryTrack = (id: string) => LIBRARY_MUSIC.find((t) => t.id === id);
export const librarySfx = (id: string) => LIBRARY_SFX.find((s) => s.id === id);

/** Fetches a bundled sound file. */
export async function fetchLibrarySound(kind: 'music' | 'sfx', id: string): Promise<Blob> {
  const res = await fetch(`${import.meta.env.BASE_URL}audio/${kind}/${id}.mp3`);
  if (!res.ok) throw new Error(`Couldn't load the sound (${res.status}). Check your connection.`);
  return res.blob();
}
