import { Editor } from './components/Editor';
import { Home } from './components/Home';
import { useEditor } from './store';

export function App() {
  const view = useEditor((s) => s.view);
  const toast = useEditor((s) => s.toast);
  return (
    <>
      {view === 'home' ? <Home /> : <Editor />}
      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
