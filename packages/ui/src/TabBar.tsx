import { Index, Show, createEffect } from 'solid-js';
import type { Tab } from './model';
import { MOD, isMac } from './model';
import { t } from './i18n';

interface Props {
  tabs: Tab[];
  activeId: string;
  /** Id of the settings tab, or null when it is not open. */
  settingsId: string | null;
  /** Leave room for the macOS traffic lights (overlay title bar). */
  inset: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

const GearIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" />
  </svg>
);

function findTab(root: ParentNode | undefined, id: string): HTMLElement | undefined {
  if (!root) return undefined;
  for (const el of root.querySelectorAll<HTMLElement>('[data-tab-id]')) {
    if (el.dataset.tabId === id) return el;
  }
  return undefined;
}

export function TabBar(props: Props) {
  let scroller: HTMLDivElement | undefined;

  // Keep the active tab visible when it changes (e.g. Ctrl+Tab, opening a file).
  createEffect(() => {
    const id = props.activeId;
    queueMicrotask(() => {
      findTab(scroller, id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  });

  const order = () => [...props.tabs.map((t) => t.id), ...(props.settingsId ? [props.settingsId] : [])];

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const ids = order();
    const i = ids.indexOf(props.activeId);
    const next =
      e.key === 'Home' ? 0 :
      e.key === 'End' ? ids.length - 1 :
      (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    e.preventDefault();
    props.onSelect(ids[next]);
    queueMicrotask(() => findTab(scroller, ids[next])?.focus());
  };

  // On macOS the strip is the title bar: empty space drags the window and
  // double-click zooms it (native behavior). Elsewhere, double-click opens a tab.
  const drag = isMac ? { 'data-tauri-drag-region': '' } : {};
  const onEmptyDblClick = (e: MouseEvent) => {
    if (!isMac && e.target === e.currentTarget) props.onNew();
  };

  // Props are accessors so title/dirty stay reactive inside <Index>.
  const tabEl = (
    id: () => string,
    title: () => string,
    tooltip: () => string,
    dirty: () => boolean,
    icon?: () => any,
  ) => (
    <div
      class="aster-tab"
      classList={{ 'is-active': id() === props.activeId, 'aster-tab-settings': id() === props.settingsId }}
      data-tab-id={id()}
      role="tab"
      aria-selected={id() === props.activeId}
      tabIndex={id() === props.activeId ? 0 : -1}
      title={tooltip()}
      onMouseDown={(e) => {
        if (e.button === 1) { e.preventDefault(); props.onClose(id()); }
      }}
      onClick={() => props.onSelect(id())}
    >
      <Show when={icon}>{icon!()}</Show>
      <span class="aster-tab-title">{title()}</span>
      <button
        class="aster-tab-close"
        classList={{ 'is-dirty': dirty() }}
        tabIndex={-1}
        aria-label={t('tab.closeLabel', { name: title() }) + (dirty() ? t('tab.unsaved') : '')}
        title={t('tab.close', { key: `${MOD}W` })}
        onClick={(e) => { e.stopPropagation(); props.onClose(id()); }}
      >
        <span class="dot" />
        <span class="x">✕</span>
      </button>
    </div>
  );

  return (
    <div class="aster-tabs" classList={{ 'is-inset': props.inset }} {...drag} onDblClick={onEmptyDblClick}>
      <div
        class="aster-tabs-scroll"
        ref={scroller}
        role="tablist"
        aria-label={t('tab.list')}
        onKeyDown={onKeyDown}
        onWheel={(e) => {
          // Let a vertical mouse wheel scroll the strip horizontally.
          if (scroller && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            scroller.scrollLeft += e.deltaY;
          }
        }}
      >
        <Index each={props.tabs}>
          {(tab) => tabEl(() => tab().id, () => tab().title, () => tab().path ?? tab().title, () => tab().dirty)}
        </Index>
        <Show when={props.settingsId}>
          {(id) => tabEl(id, () => t('tab.settings'), () => `${t('tab.settings')} (${MOD},)`, () => false, GearIcon)}
        </Show>
      </div>
      <button class="aster-tab-add" aria-label={t('tab.new', { key: '' }).replace(/[（(]\s*[)）]/, '').trim()} title={t('tab.new', { key: `${MOD}N` })} onClick={() => props.onNew()}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
      <div class="aster-tabs-spacer" {...drag} onDblClick={() => { if (!isMac) props.onNew(); }} />
    </div>
  );
}
