import { useState } from 'react';
import {
  addAssetToTimeline,
  addSticker,
  addText,
  applyFilter,
  applyFilterToAll,
  applyTransition,
  importFiles,
  removeAsset,
  targetVisualClip,
} from '../actions';
import { DEFAULT_TEXT, FILTERS, STICKERS, TEXT_TEMPLATES, TRANSITIONS } from '../model/presets';
import type { Asset } from '../model/types';
import { selectedClip, useEditor, type LeftTab } from '../store';
import { Icon } from '../ui/Icon';
import { formatBytes, formatDuration } from '../utils';

const TABS: { id: LeftTab; label: string; icon: string }[] = [
  { id: 'media', label: 'Media', icon: 'media' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'stickers', label: 'Stickers', icon: 'sticker' },
  { id: 'filters', label: 'Filters', icon: 'filter' },
  { id: 'transitions', label: 'Transitions', icon: 'transition' },
];

export const ASSET_MIME = 'application/x-clipforge-asset';

export function Library() {
  const tab = useEditor((s) => s.leftTab);
  return (
    <aside className="library panel">
      <nav className="lib-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => useEditor.setState({ leftTab: t.id })}
          >
            <Icon name={t.icon} size={20} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="lib-body">
        {tab === 'media' && <MediaTab kinds={['video', 'image']} />}
        {tab === 'audio' && <MediaTab kinds={['audio']} />}
        {tab === 'text' && <TextTab />}
        {tab === 'stickers' && <StickerTab />}
        {tab === 'filters' && <FilterTab />}
        {tab === 'transitions' && <TransitionTab />}
      </div>
    </aside>
  );
}

function ImportButton({ accept, label }: { accept: string; label: string }) {
  const importing = useEditor((s) => s.importing);
  return (
    <label className={`import-btn ${importing ? 'busy' : ''}`}>
      <Icon name="upload" />
      <span>{importing ? `Importing ${importing}...` : label}</span>
      <input
        type="file"
        multiple
        accept={accept}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function MediaTab({ kinds }: { kinds: Asset['kind'][] }) {
  const assets = useEditor((s) => s.assets);
  const clips = useEditor((s) => s.project.clips);
  const [filter, setFilter] = useState<'all' | Asset['kind']>('all');
  const list = Object.values(assets).filter((a) => kinds.includes(a.kind) && (filter === 'all' || a.kind === filter));
  const isAudio = kinds.includes('audio');
  const used = new Set(clips.map((c) => c.assetId));

  return (
    <div className="media-tab">
      <ImportButton accept={isAudio ? 'audio/*,video/*' : 'video/*,image/*'} label={isAudio ? 'Import audio' : 'Import'} />
      {!isAudio && (
        <div className="chips">
          {(['all', 'video', 'image'] as const).map((k) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {k === 'all' ? 'All' : k === 'video' ? 'Videos' : 'Photos'}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <div className="empty-lib">
          <Icon name={isAudio ? 'audio' : 'media'} size={32} />
          <p>{isAudio ? 'Import music, voiceovers or sound effects.' : 'Import videos and photos, or drop files anywhere.'}</p>
        </div>
      ) : isAudio ? (
        <ul className="audio-list">
          {list.map((a) => (
            <li
              key={a.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_MIME, a.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDoubleClick={() => addAssetToTimeline(a.id)}
            >
              <span className="audio-ico">
                <Icon name="audio" />
              </span>
              <span className="audio-name">
                <strong title={a.name}>{a.name}</strong>
                <small>
                  {formatDuration(a.duration)} - {formatBytes(a.size)}
                </small>
              </span>
              <button className="icon-btn" title="Add to timeline" onClick={() => addAssetToTimeline(a.id)}>
                <Icon name="plus" />
              </button>
              <button className="icon-btn danger" title="Remove" onClick={() => removeAsset(a.id)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="asset-grid">
          {list.map((a) => (
            <figure
              key={a.id}
              className="asset"
              draggable
              title={`${a.name}\nDouble-click or press + to add`}
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_MIME, a.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDoubleClick={() => addAssetToTimeline(a.id)}
            >
              <div className="asset-thumb">
                {a.thumbnail ? <img src={a.thumbnail} alt="" draggable={false} /> : <Icon name="image" />}
                {a.kind === 'video' && <span className="badge">{formatDuration(a.duration)}</span>}
                {used.has(a.id) && <span className="badge used">Added</span>}
                <button className="asset-add" title="Add to timeline" onClick={() => addAssetToTimeline(a.id)}>
                  <Icon name="plus" size={16} />
                </button>
                <button className="asset-del" title="Remove from project" onClick={() => removeAsset(a.id)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <figcaption>{a.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function TextTab() {
  return (
    <div>
      <button className="btn primary block" onClick={() => addText()}>
        <Icon name="plus" /> Add text
      </button>
      <h5 className="lib-h">Templates</h5>
      <div className="text-grid">
        {TEXT_TEMPLATES.map((t) => {
          const s = { ...DEFAULT_TEXT, ...t.style };
          return (
            <button key={t.id} className="text-tpl" onClick={() => addText(t.style)} title={`Add "${t.label}"`}>
              <span
                style={{
                  fontFamily: s.fontFamily,
                  fontWeight: s.bold ? 700 : 400,
                  fontStyle: s.italic ? 'italic' : 'normal',
                  color: s.color,
                  background: s.background ?? 'transparent',
                  padding: s.background ? '2px 8px' : 0,
                  borderRadius: 4,
                  WebkitTextStroke: s.strokeWidth ? `${Math.min(2, s.strokeWidth / 4)}px ${s.strokeColor}` : undefined,
                  textShadow: s.shadow ? '0 2px 6px rgba(0,0,0,.6)' : undefined,
                }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StickerTab() {
  return (
    <div className="sticker-grid">
      {STICKERS.map((s) => (
        <button key={s} onClick={() => addSticker(s)} title="Add sticker">
          {s}
        </button>
      ))}
    </div>
  );
}

function FilterTab() {
  const sel = useEditor(selectedClip);
  useEditor((s) => s.currentTime);
  const target = sel && (sel.kind === 'video' || sel.kind === 'image') ? sel : targetVisualClip();
  const current = target?.filter ?? null;
  const thumb = useEditor((s) => (target?.assetId ? s.assets[target.assetId]?.thumbnail : undefined));
  return (
    <div>
      <p className="lib-note">
        {target ? <>Applying to <strong>{target.name}</strong></> : 'Select a video or photo clip to apply a filter.'}
      </p>
      <div className="filter-grid">
        {FILTERS.map((f) => (
          <button key={f.id} className={`filter-opt ${current === f.id ? 'on' : ''}`} onClick={() => applyFilter(f.id)}>
            <span
              className="filter-swatch"
              style={{
                backgroundImage: thumb ? `url(${thumb})` : f.swatch,
                filter: f.css || undefined,
              }}
            />
            <span>{f.label}</span>
          </button>
        ))}
      </div>
      {current && current !== 'none' && (
        <button className="btn block" onClick={() => applyFilterToAll(current)}>
          Apply to all clips
        </button>
      )}
    </div>
  );
}

function TransitionTab() {
  const sel = useEditor(selectedClip);
  return (
    <div>
      <p className="lib-note">
        {sel ? (
          <>
            Transition into <strong>{sel.name}</strong> from the clip before it.
          </>
        ) : (
          'Select the clip after a cut, or the cut nearest the playhead is used.'
        )}
      </p>
      <div className="transition-grid">
        {TRANSITIONS.map((t) => (
          <button
            key={t.id}
            className={`transition-opt ${sel?.transition === t.id ? 'on' : ''}`}
            onClick={() => applyTransition(t.id)}
          >
            <span className={`tr-demo tr-${t.id}`}>
              <i />
              <b />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
