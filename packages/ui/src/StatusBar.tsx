import { Show } from 'solid-js';
import type { EditorMode } from './model';
import { MOD, readingMinutes } from './model';
import { t } from './i18n';

interface Props {
  words: number;
  mode: EditorMode;
  encodingLossy: boolean;
  /** True while the user is actively typing so the footer gently fades into the background. */
  typing: boolean;
  notice: { text: string; error?: boolean } | null;
  onModeChange: (m: EditorMode) => void;
}

export function StatusBar(props: Props) {
  const mins = () => readingMinutes(props.words);

  return (
    <div class="aster-status" classList={{ 'is-typing': props.typing && !props.notice }} role="status">
      <div class="aster-status-meta">
        <span>{props.words === 1 ? t('status.word') : t('status.words', { n: props.words })}</span>
        <Show when={mins() > 0}>
          <span class="aster-status-sep" aria-hidden="true">·</span>
          <span>{t('status.readTime', { m: mins() })}</span>
        </Show>
        <Show when={props.encodingLossy}>
          <span class="aster-status-badge">{t('status.encodingBadge')}</span>
        </Show>
        <Show when={props.notice}>
          {(n) => (
            <>
              <span class="aster-status-sep" aria-hidden="true">·</span>
              <span class="aster-status-notice" classList={{ 'is-error': !!n().error }}>{n().text}</span>
            </>
          )}
        </Show>
      </div>
      <div class="aster-seg" role="group" aria-label={t('status.modeGroup')}>
        <button
          type="button"
          classList={{ 'is-on': props.mode === 'live' }}
          aria-pressed={props.mode === 'live'}
          title={t('status.liveTip', { key: `${MOD}/` })}
          onClick={() => props.onModeChange('live')}
        >{t('status.live')}</button>
        <button
          type="button"
          classList={{ 'is-on': props.mode === 'source' }}
          aria-pressed={props.mode === 'source'}
          title={t('status.sourceTip', { key: `${MOD}/` })}
          onClick={() => props.onModeChange('source')}
        >{t('status.source')}</button>
        <button
          type="button"
          classList={{ 'is-on': props.mode === 'read' }}
          aria-pressed={props.mode === 'read'}
          title={t('status.readTip')}
          onClick={() => props.onModeChange('read')}
        >{t('status.read')}</button>
      </div>
    </div>
  );
}
