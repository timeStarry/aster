import type { EditorMode } from '@aster/editor';

interface Props {
  wordCount: number;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
}

const MODES: EditorMode[] = ['live', 'source', 'reading'];

export function StatusBar(props: Props) {
  return (
    <div style={{
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      background: 'var(--status-bg)',
      'border-top': '1px solid var(--border)',
      height: '24px',
      padding: '0 12px',
      'font-size': '12px',
      opacity: '0.85',
    }}>
      <span>{props.wordCount} words</span>
      <span style={{ display: 'flex', gap: '6px' }}>
        {MODES.map((m) => (
          <button
            style={{
              background: props.mode === m ? 'var(--accent)' : 'transparent',
              color: props.mode === m ? '#fff' : 'inherit',
              border: 'none',
              'border-radius': '3px',
              padding: '1px 7px',
              cursor: 'pointer',
              'font-size': '11px',
            }}
            onClick={() => props.onModeChange(m)}
          >
            {m}
          </button>
        ))}
      </span>
    </div>
  );
}
