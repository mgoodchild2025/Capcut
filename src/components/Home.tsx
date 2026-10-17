import { useEffect, useState } from 'react';
import { addAssetToTimeline, importFiles, newProject, openDraft } from '../actions';
import { deleteDraft, listDrafts, renameDraft, type DraftSummary } from '../engine/persist';
import { ASPECT_PRESETS } from '../model/presets';
import { Icon } from '../ui/Icon';
import { formatDuration } from '../utils';

export function Home() {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [aspect, setAspect] = useState<string>('16:9');
  const [dragging, setDragging] = useState(false);

  const refresh = () =>
    listDrafts()
      .then(setDrafts)
      .catch(() => setDrafts([]));

  useEffect(() => {
    void refresh();
  }, []);

  const preset = ASPECT_PRESETS.find((a) => a.id === aspect) ?? ASPECT_PRESETS[0];

  const startWithFiles = async (files: FileList | File[]) => {
    newProject(preset.width, preset.height);
    const assets = await importFiles(files);
    for (const a of assets) addAssetToTimeline(a.id);
  };

  return (
    <div
      className={`home ${dragging ? 'drop-active' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void startWithFiles(e.dataTransfer.files);
      }}
    >
      <header className="home-top">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="play" size={14} />
          </span>
          ClipForge
        </div>
        <span className="home-sub">Edit videos right in your browser. Nothing is uploaded.</span>
      </header>

      <section className="hero">
        <div className="hero-card">
          <h1>Start creating</h1>
          <p>Pick a canvas, then drop in clips, photos and music.</p>
          <div className="aspect-picker" role="radiogroup" aria-label="Aspect ratio">
            {ASPECT_PRESETS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={aspect === a.id}
                className={`aspect-opt ${aspect === a.id ? 'on' : ''}`}
                onClick={() => setAspect(a.id)}
              >
                <span className="aspect-shape" style={{ aspectRatio: `${a.width} / ${a.height}` }} />
                <strong>{a.label}</strong>
                <small>{a.hint}</small>
              </button>
            ))}
          </div>
          <div className="hero-actions">
            <button className="btn primary big" onClick={() => newProject(preset.width, preset.height)}>
              <Icon name="plus" /> New project
            </button>
            <label className="btn big">
              <Icon name="upload" /> Import media
              <input
                type="file"
                multiple
                accept="video/*,audio/*,image/*"
                hidden
                onChange={(e) => e.target.files?.length && void startWithFiles(e.target.files)}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="drafts">
        <h2>Drafts</h2>
        {drafts === null ? (
          <p className="muted">Loading drafts...</p>
        ) : drafts.length === 0 ? (
          <p className="muted">No drafts yet. Projects save automatically as you edit.</p>
        ) : (
          <div className="draft-grid">
            {drafts.map((d) => (
              <article key={d.id} className="draft">
                <button className="draft-thumb" onClick={() => void openDraft(d.id)} title="Open">
                  {d.thumbnail ? <img src={d.thumbnail} alt="" /> : <Icon name="film" size={28} />}
                  <span className="draft-dur">{formatDuration(d.duration)}</span>
                </button>
                <div className="draft-meta">
                  <div>
                    <strong title={d.name}>{d.name}</strong>
                    <small>
                      {new Date(d.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </small>
                  </div>
                  <div className="draft-actions">
                    <button
                      className="icon-btn"
                      title="Rename"
                      onClick={async () => {
                        const name = prompt('Rename project', d.name);
                        if (name?.trim()) {
                          await renameDraft(d.id, name.trim());
                          void refresh();
                        }
                      }}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete"
                      onClick={async () => {
                        if (confirm(`Delete "${d.name}"? This cannot be undone.`)) {
                          await deleteDraft(d.id);
                          void refresh();
                        }
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {dragging && <div className="drop-overlay">Drop media to start a new project</div>}
    </div>
  );
}
