import { useEffect, useState } from 'react';
import { addAssetToTimeline, importFiles, newProject, openDraft, openProjectFile, saveDraftToFile } from '../actions';
import { deleteDraft, listDrafts, renameDraft, type DraftSummary } from '../engine/persist';
import { ASPECT_PRESETS } from '../model/presets';
import { useEditor } from '../store';
import { REEL_STYLES } from '../templates/reel';
import { Icon } from '../ui/Icon';
import { formatDuration, isIOS, isStandalone } from '../utils';

const TILE_WORD: Record<string, string> = { recruiting: '#12', hype: '#12', spotlight: 'MVP', potw: 'POTW', team: 'TEAM', victory: 'WIN', lineup: 'LINEUP', matchup: 'VS', recap: 'SEASON' };

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

      <InstallTip />

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
          <label className="link-btn open-file">
            <Icon name="folder" size={15} /> Open a project file
            {/* No type filter: phones grey out file types they don't recognise. */}
            <input
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void openProjectFile(f);
              }}
            />
          </label>
        </div>
      </section>

      <section className="templates">
        <div className="templates-head">
          <h2>
            <Icon name="volleyball" /> Sports highlight reels
          </h2>
          <p>Drop in game footage. AI finds the best rallies, then we build the reel: titles, spotlights, music and all.</p>
        </div>
        <button className="poster-banner" onClick={() => useEditor.setState({ posters: {} })}>
          <span className="poster-banner-art" aria-hidden="true">
            <Icon name="image" size={26} />
          </span>
          <span>
            <strong>Graphics &amp; posters</strong>
            <small>Game day, final score, victory, player spotlight, Play of the Week, college commitment, stats and lineup images, sized for Stories, posts and X.</small>
          </span>
          <span className="tpl-go">
            Make one <Icon name="chevronRight" size={16} />
          </span>
        </button>
        <div className="tpl-cards">
          {REEL_STYLES.map((t, i) => (
            <button
              key={t.id}
              className={`tpl-card tpl-${t.id}`}
              style={{ animationDelay: `${i * 80}ms` }}
              onClick={() => {
                newProject(t.aspect[0], t.aspect[1]);
                useEditor.setState({ wizard: { style: t.id }, leftTab: 'volleyball' });
              }}
            >
              <span className="tpl-art" aria-hidden="true">
                <span className={`tpl-frame ${t.aspect[0] * 5 === t.aspect[1] * 4 ? 'feed' : t.aspect[1] > t.aspect[0] ? 'tall' : 'wide'}`}>
                  <b>{TILE_WORD[t.id]}</b>
                  <i />
                </span>
              </span>
              <strong>{t.title}</strong>
              <small>{t.blurb}</small>
              <span className="tpl-go">
                Start <Icon name="chevronRight" size={16} />
              </span>
            </button>
          ))}
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
                    <button className="icon-btn" title="Save to file (to move it to another device)" aria-label={`Save ${d.name} to a file`} onClick={() => void saveDraftToFile(d.id)}>
                      <Icon name="share" size={16} />
                    </button>
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

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const TIP_KEY = 'clipforge.installTip';

/** Offers to install the app: the browser's own prompt where there is one, instructions on iPhone. */
function InstallTip() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return isStandalone() || localStorage.getItem(TIP_KEY) === 'dismissed';
    } catch {
      return isStandalone();
    }
  });
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  const ios = isIOS();
  if (hidden || (!prompt && !ios)) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(TIP_KEY, 'dismissed');
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <aside className="install-tip">
      <img src="./icons/icon-192.png" alt="" width={44} height={44} />
      <span className="install-text">
        <strong>Install ClipForge</strong>
        {ios ? (
          <small>
            Tap <Icon name="share" size={13} /> Share, then <b>Add to Home Screen</b>. It opens full screen, like an app.
          </small>
        ) : (
          <small>Opens full screen from your home screen or dock, and works offline.</small>
        )}
      </span>
      {prompt && (
        <button
          className="btn primary"
          onClick={async () => {
            await prompt.prompt();
            setPrompt(null);
          }}
        >
          Install
        </button>
      )}
      <button className="icon-btn" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="close" size={16} />
      </button>
    </aside>
  );
}
