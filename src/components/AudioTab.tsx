import { useEffect, useState } from 'react';
import { addMusic, addSfx, startVoiceover, stopPreviewSound, stopVoiceover, togglePreviewSound } from '../actions';
import { MUSIC, SFX, trackLength } from '../audio/synth';
import { useEditor } from '../store';
import { Icon } from '../ui/Icon';
import { formatDuration, formatTimecode } from '../utils';

type Section = 'music' | 'sfx' | 'mine' | 'record';

export function AudioTab({ mine }: { mine: React.ReactNode }) {
  const [section, setSection] = useState<Section>('music');
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  useEffect(() => stopPreviewSound, []);

  const preview = async (kind: 'music' | 'sfx', id: string) => {
    const key = `${kind}:${id}`;
    setLoading(key);
    const on = await togglePreviewSound(kind, id);
    setLoading(null);
    setPlaying(on ? key : null);
  };

  return (
    <div className="audio-tab">
      <div className="chips" role="tablist">
        {(
          [
            ['music', 'Music'],
            ['sfx', 'Sound FX'],
            ['mine', 'Imported'],
            ['record', 'Voiceover'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {section === 'music' && (
        <>
          <p className="lib-note">Royalty-free tracks made right in your browser. Beats are known, so cuts can snap to them.</p>
          <ul className="music-list">
            {MUSIC.map((m) => {
              const key = `music:${m.id}`;
              const { seconds } = trackLength(m);
              return (
                <li key={m.id} className="music-item">
                  <button
                    className={`music-art ${playing === key ? 'playing' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${m.colors[0]}, ${m.colors[1]})` }}
                    onClick={() => void preview('music', m.id)}
                    aria-label={playing === key ? `Stop ${m.title}` : `Preview ${m.title}`}
                  >
                    {loading === key ? <span className="spinner" /> : <Icon name={playing === key ? 'pause' : 'play'} size={18} />}
                  </button>
                  <span className="music-meta">
                    <strong>{m.title}</strong>
                    <small>
                      {m.mood} · {m.bpm} BPM · {formatDuration(seconds)}
                    </small>
                  </span>
                  <button className="icon-btn add" title={`Add ${m.title}`} aria-label={`Add ${m.title}`} onClick={() => void addMusic(m.id)}>
                    <Icon name="plus" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {section === 'sfx' && (
        <>
          <p className="lib-note">Tap to hear, + to drop at the playhead.</p>
          <div className="sfx-grid">
            {SFX.map((x) => {
              const key = `sfx:${x.id}`;
              return (
                <div key={x.id} className={`sfx-item ${playing === key ? 'playing' : ''}`}>
                  <button className="sfx-play" onClick={() => void preview('sfx', x.id)}>
                    {loading === key ? <span className="spinner" /> : <Icon name={playing === key ? 'pause' : 'volume'} size={16} />}
                    <span>{x.title}</span>
                  </button>
                  <button className="mini" aria-label={`Add ${x.title}`} title="Add at playhead" onClick={() => void addSfx(x.id)}>
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {section === 'mine' && mine}

      {section === 'record' && <VoiceoverPanel />}
    </div>
  );
}

function VoiceoverPanel() {
  const recording = useEditor((s) => s.recording);
  const t = useEditor((s) => s.currentTime);
  const fps = useEditor((s) => s.project.settings.fps);
  return (
    <div className="voiceover">
      <p className="lib-note">
        Records from your microphone starting at the playhead. The timeline plays silently while you talk so you can time your words.
      </p>
      <button
        className={`rec-btn ${recording ? 'on' : ''}`}
        onClick={() => (recording ? stopVoiceover() : void startVoiceover())}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
      >
        <span />
      </button>
      <p className="rec-status">
        {recording ? (
          <>
            Recording <b>{formatTimecode(Math.max(0, t - recording.start), fps)}</b>
          </>
        ) : (
          'Tap to record'
        )}
      </p>
    </div>
  );
}
