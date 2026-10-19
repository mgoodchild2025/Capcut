/**
 * A page left open across a release can ask for a code file from its own (now replaced) build,
 * which the server no longer has: Safari reports "Importing a module script failed". The service
 * worker keeps recent builds' files to prevent it; if one is missing anyway, the project is saved
 * and the page reloads into the latest version with the same project open.
 */
import { openDraft, saveNow } from './actions';
import { toast, useEditor } from './store';

const KEY = 'clipforge.updated';

const STALE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i;

/** Whether an error is a code file of this page's build that couldn't be loaded. */
export const isStaleBuild = (e: unknown) => STALE.test(String((e as Error)?.message ?? e));

let reloading = false;

/**
 * Saves the project and reloads into the latest version. Automatic reloads happen at most once a
 * minute, so a missing file can't cause a loop; asking for the update (`asked`) always goes ahead.
 */
export async function reloadForUpdate(asked = false): Promise<boolean> {
  if (reloading) return true;
  if (!asked) {
    try {
      const last = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { at: number } | null;
      if (last && Date.now() - last.at < 60_000) return false;
    } catch {
      /* storage unavailable: reload anyway */
    }
  }
  reloading = true;
  const { view, project } = useEditor.getState();
  await saveNow(true);
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), id: view === 'editor' ? project.id : null }));
  } catch {
    /* ignore */
  }
  location.reload();
  return true;
}

/** After such a reload: reopen the project that was open, and say what happened. */
export async function resumeAfterUpdate() {
  let note: { at: number; id: string | null } | null = null;
  try {
    note = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    return;
  }
  if (!note || Date.now() - note.at > 60_000) return;
  if (note.id) await openDraft(note.id);
  toast(note.id ? 'ClipForge is now on the latest version. Your project is saved and open where you left it (press Export again if you were exporting).' : 'ClipForge is now on the latest version.');
}

/** The app's own entry file, which changes with every release. */
const runningEntry = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.src ?? null;

/** Whether the server has a newer release than the one running (asks the server, never a cache). */
export async function newerRelease(): Promise<boolean> {
  const running = runningEntry();
  if (!running || !navigator.onLine) return false;
  try {
    const html = await (await fetch('./', { cache: 'no-store' })).text();
    const m = html.match(/src="([^"]*assets\/index-[^"]+\.js)"/);
    return !!m && new URL(m[1], location.href).href !== running;
  } catch {
    return false;
  }
}

/** Looks for a new release when the app comes back to the foreground (phones resume apps without reloading them). */
function watchForRelease() {
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== 'visible' || useEditor.getState().updateReady) return;
    checking = true;
    try {
      if (!(await newerRelease())) return;
      // Nothing open to lose on the home screen: just move to the new release.
      // (The server has confirmed a newer release, so this can't loop.)
      if (useEditor.getState().view === 'home') void reloadForUpdate(true);
      else useEditor.setState({ updateReady: true });
    } finally {
      checking = false;
    }
  };
  document.addEventListener('visibilitychange', () => void check());
  setInterval(() => void check(), 15 * 60_000);
}

export function watchForStaleBuild() {
  watchForRelease();
  // Vite reports a lazily loaded file that failed to load.
  window.addEventListener('vite:preloadError', (e) => {
    if (isStaleBuild((e as Event & { payload?: unknown }).payload)) void reloadForUpdate();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isStaleBuild(e.reason)) void reloadForUpdate();
  });
}
