import { Show } from 'solid-js';
import type { EditorMode } from './model';
import { MOD, ALT } from './model';
import { t } from './i18n';

interface Props {
  path: string | null;
  words: number;
  line: number;
  col: number;
  mode: EditorMode;
  readOnly: boolean;
  notice: { text: string; error?: boolean } | null;
  /** False while a non-document tab (Settings) is active. */
  editorActive: boolean;
  settingsActive: boolean;
  onModeChange: (m: EditorMode) => void;
  onToggleLock: () => void;
  onSettings: () => void;
}

const LockIcon = (p: { locked: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    {p.locked ? <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /> : <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />}
  </svg>
);

const GearIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" />
  </svg>
);

export function StatusBar(props: Props) {
  return (
    <div class="aster-status" role="status">
      <span class="aster-status-path" title={props.path ?? ''}>
        <Show when={props.notice} fallback={props.editorActive ? (props.path ?? t('status.notSaved')) : t('tab.settings')}>
          <span style={{ color: props.notice?.error ? 'var(--danger)' : 'var(--fg)' }}>{props.notice?.text}</span>
        </Show>
      </span>
      <Show when={props.editorActive}>
      <span>{props.words === 1 ? t('status.word') : t('status.words', { n: props.words })}</span>
      <span>{t('status.lnCol', { line: props.line, col: props.col })}</span>
      <div class="aster-seg" role="group" aria-label={t('status.modeGroup')}>
        <button
          classList={{ 'is-on': props.mode === 'live' }}
          aria-pressed={props.mode === 'live'}
          title={t('status.liveTip', { key: `${MOD}/` })}
          onClick={() => props.onModeChange('live')}
        >{t('status.live')}</button>
        <button
          classList={{ 'is-on': props.mode === 'source' }}
          aria-pressed={props.mode === 'source'}
          title={t('status.sourceTip', { key: `${MOD}/` })}
          onClick={() => props.onModeChange('source')}
        >{t('status.source')}</button>
      </div>
      <button
        class="aster-icon-btn"
        classList={{ 'is-on': props.readOnly }}
        aria-pressed={props.readOnly}
        aria-label={t('status.readOnly')}
        title={props.readOnly ? t('status.lockOnTip', { key: `${MOD}${ALT}L` }) : t('status.lockOffTip', { key: `${MOD}${ALT}L` })}
        onClick={() => props.onToggleLock()}
      >
        <LockIcon locked={props.readOnly} />
      </button>
      </Show>
      <button
        class="aster-icon-btn"
        classList={{ 'is-on': props.settingsActive }}
        aria-label={t('tab.settings')}
        aria-pressed={props.settingsActive}
        title={`${t('tab.settings')} (${MOD},)`}
        onClick={() => props.onSettings()}
      >
        <GearIcon />
      </button>
    </div>
  );
}
