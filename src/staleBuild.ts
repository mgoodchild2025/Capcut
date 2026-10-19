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

/** Saves the project and reloads into the latest version (at most once a minute, so it can't loop). */
export async function reloadForUpdate(): Promise<boolean> {
  if (reloading) return true;
  try {
    const last = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { at: number } | null;
    if (last && Date.now() - last.at < 60_000) return false;
  } catch {
    /* storage unavailable: reload anyway */
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
  toast('ClipForge updated to the latest version while it was open. Your project is saved; carry on where you were (press Export again if you were exporting).');
}

export function watchForStaleBuild() {
  // Vite reports a lazily loaded file that failed to load.
  window.addEventListener('vite:preloadError', (e) => {
    if (isStaleBuild((e as Event & { payload?: unknown }).payload)) void reloadForUpdate();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isStaleBuild(e.reason)) void reloadForUpdate();
  });
}
