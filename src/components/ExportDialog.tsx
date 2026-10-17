import { useEffect, useRef, useState } from 'react';
import { Engine, engine } from '../engine/engine';
import { projectDuration } from '../model/ops';
import { useEditor } from '../store';
import { Segmented } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { formatBytes, formatDuration } from '../utils';

const RESOLUTIONS = [480, 720, 1080, 1440, 2160];
const QUALITY = { low: 0.06, recommended: 0.12, high: 0.2 } as const;

type Phase = { kind: 'setup' } | { kind: 'rendering'; progress: number } | { kind: 'done'; url: string; size: number; ext: string } | { kind: 'error'; message: string };

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const duration = projectDuration(project);
  const shortSide = Math.min(project.settings.width, project.settings.height);
  const [res, setRes] = useState(RESOLUTIONS.includes(shortSide) ? shortSide : 1080);
  const [fps, setFps] = useState(project.settings.fps);
  const [quality, setQuality] = useState<keyof typeof QUALITY>('recommended');
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abort = useRef<AbortController | null>(null);
  const mime = Engine.pickMimeType();
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';

  const scale = res / shortSide;
  const outW = Math.round((project.settings.width * scale) / 2) * 2;
  const outH = Math.round((project.settings.height * scale) / 2) * 2;
  const bitrate = Math.round(outW * outH * fps * QUALITY[quality]);
  const estimate = (bitrate / 8) * duration;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (phase.kind !== 'done') return;
    return () => URL.revokeObjectURL(phase.url);
  }, [phase]);

  const start = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: 'rendering', progress: 0 });
    try {
      const { blob } = await engine.export({
        shortSide: res,
        fps,
        bitrate,
        signal: ac.signal,
        onProgress: (progress) => setPhase((p) => (p.kind === 'rendering' ? { kind: 'rendering', progress } : p)),
      });
      setPhase({ kind: 'done', url: URL.createObjectURL(blob), size: blob.size, ext });
    } catch (err) {
      if ((err as Error).name === 'AbortError') setPhase({ kind: 'setup' });
      else setPhase({ kind: 'error', message: (err as Error).message });
    }
  };

  const fileName = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'video'}.${ext}`;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && phase.kind !== 'rendering' && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header>
          <h3 id="export-title">Export</h3>
          {phase.kind !== 'rendering' && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </header>

        {phase.kind === 'setup' && (
          <>
            <div className="field">
              <span>Resolution</span>
              <Segmented value={res} onChange={setRes} options={RESOLUTIONS.map((r) => ({ value: r, label: r === 2160 ? '4K' : `${r}p` }))} />
            </div>
            <div className="field">
              <span>Frame rate</span>
              <Segmented value={fps} onChange={setFps} options={[24, 25, 30, 50, 60].map((f) => ({ value: f, label: String(f) }))} />
            </div>
            <div className="field">
              <span>Quality</span>
              <Segmented
                value={quality}
                onChange={setQuality}
                options={[
                  { value: 'low', label: 'Smaller file' },
                  { value: 'recommended', label: 'Recommended' },
                  { value: 'high', label: 'Higher quality' },
                ]}
              />
            </div>
            <dl className="export-summary">
              <dt>Output</dt>
              <dd>
                {outW} x {outH}, {ext.toUpperCase()}
              </dd>
              <dt>Duration</dt>
              <dd>{formatDuration(duration)}</dd>
              <dt>Estimated size</dt>
              <dd>~{formatBytes(estimate)}</dd>
            </dl>
            <p className="muted small">
              Export plays the project through once in real time, so it takes about {formatDuration(duration)}. Keep this tab visible
              until it finishes.
            </p>
            <footer>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={duration === 0 || !mime} onClick={start}>
                <Icon name="export" /> Export
              </button>
            </footer>
            {!mime && <p className="error">Your browser does not support video recording.</p>}
          </>
        )}

        {phase.kind === 'rendering' && (
          <div className="export-progress">
            <div className="ring" style={{ '--p': phase.progress } as React.CSSProperties}>
              <span>{Math.round(phase.progress * 100)}%</span>
            </div>
            <p>Rendering your video...</p>
            <button className="btn" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </div>
        )}

        {phase.kind === 'done' && (
          <div className="export-done">
            <video src={phase.url} controls playsInline />
            <p>
              <Icon name="check" /> Ready. {formatBytes(phase.size)}
            </p>
            <footer>
              <button className="btn" onClick={() => setPhase({ kind: 'setup' })}>
                Export again
              </button>
              <a className="btn primary" href={phase.url} download={fileName}>
                <Icon name="export" /> Download
              </a>
            </footer>
          </div>
        )}

        {phase.kind === 'error' && (
          <div>
            <p className="error">{phase.message}</p>
            <footer>
              <button className="btn" onClick={() => setPhase({ kind: 'setup' })}>
                Back
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
