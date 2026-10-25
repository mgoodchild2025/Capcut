import { Editor } from './components/Editor';
import { Home } from './components/Home';
import { PosterStudio } from './components/PosterStudio';
import { reloadForUpdate } from './staleBuild';
import { useEditor } from './store';

export function App() {
  const view = useEditor((s) => s.view);
  const toast = useEditor((s) => s.toast);
  const updateReady = useEditor((s) => s.updateReady);
  const posters = useEditor((s) => !!s.posters);
  return (
    <>
      {view === 'home' ? <Home /> : <Editor />}
      {posters && <PosterStudio />}
      {updateReady && (
        <div className="update-ready" role="status">
          <span>A new version of ClipForge is ready.</span>
          <button className="btn primary" onClick={() => void reloadForUpdate(true)}>
            Update
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
