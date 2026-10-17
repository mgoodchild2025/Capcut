import { useEffect, useState } from 'react';
import { addMusic, addSfx, generateSpeech, startVoiceover, stopPreviewSound, stopVoiceover, togglePreviewSound } from '../actions';
import { TTS_VOICES } from '../ai/tts';
import { LIBRARY_MUSIC, LIBRARY_SFX } from '../audio/library';
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
          <p className="lib-note">Studio recordings, free to use anywhere (CC0). Beats are known, so cuts can snap to them.</p>
          <ul className="music-list">
            {[
              ...LIBRARY_MUSIC.map((m) => ({ ...m, mood: `${m.mood} · ${m.artist}` })),
              ...MUSIC.map((m) => ({ ...m, mood: `${m.mood} · Generated`, seconds: trackLength(m).seconds })),
            ].map((m) => {
              const key = `music:${m.id}`;
              const { seconds } = m;
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
          <p className="lib-note subtle">
            Music by Liq_mmry, cynicmusic, Alexander Ehlers, Emma_MA, Zane Little Music and Joth; sounds by Kenney and OpenGameArt artists. All released to the public domain (CC0).
          </p>
        </>
      )}

      {section === 'sfx' && (
        <>
          <p className="lib-note">Tap to hear, + to drop at the playhead.</p>
          <div className="sfx-grid">
            {[...LIBRARY_SFX, ...SFX.filter((x) => !LIBRARY_SFX.some((r) => r.id === x.id))].map((x) => {
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
  const busy = useEditor((s) => !!s.task);
  const [script, setScript] = useState('');
  const [voice, setVoice] = useState(TTS_VOICES[0].id);
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
      <div className="tts">
        <h5 className="lib-h">
          <Icon name="sparkle" size={13} /> Text to speech (AI)
        </h5>
        <textarea
          className="text-input"
          rows={3}
          placeholder="Type what the narrator should say..."
          value={script}
          onChange={(e) => setScript(e.target.value)}
          maxLength={600}
        />
        <div className="tts-row">
          <select className="select" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice">
            {TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={busy || !script.trim()} onClick={() => void generateSpeech(script, voice)}>
            Speak
          </button>
        </div>
        <p className="muted small">Runs on your device. The first use downloads a voice model.</p>
      </div>
    </div>
  );
}
