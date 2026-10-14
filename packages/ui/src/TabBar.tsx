import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
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
  onOpen: () => void;
  onSettings: () => void;
  /** Keep PDF reachable when the Windows native menu row is hidden. */
  onExportPdf?: () => void;
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

/**
 * "+" opens a blank tab in one click; the chevron next to it opens a menu with
 * other actions (open a file, PDF export, settings). A click-to-open menu rather
 * than hover: hover menus pop up on fly-overs and can't be reached by keyboard.
 */
function NewTabButton(p: { onNew: () => void; onOpen: () => void; onSettings: () => void; onExportPdf?: () => void }) {
  const [open, setOpen] = createSignal(false);
  const [menuLeft, setMenuLeft] = createSignal(0);
  let root!: HTMLDivElement;
  let toggle!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  const items = () => [
    { id: 'new', label: t('tab.menuNew'), key: `${MOD}N`, run: p.onNew },
    { id: 'open', label: t('tab.menuOpen'), key: `${MOD}O`, run: p.onOpen },
    ...(p.onExportPdf ? [{ id: 'exportPdf', label: t('tab.menuExportPdf'), key: '', run: p.onExportPdf }] : []),
    { id: 'settings', label: t('tab.menuSettings'), key: `${MOD},`, run: p.onSettings },
  ];
  const positionMenu = () => {
    if (!open() || !menu) return;
    const anchor = root.getBoundingClientRect();
    const width = menu.getBoundingClientRect().width;
    // Many tabs push the split button to the right edge. Keep its menu
    // inside the viewport, including after resizing an open menu.
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    setMenuLeft(left - anchor.left);
  };
  const focusItem = (i: number) => root.querySelectorAll<HTMLElement>('[role="menuitem"]')[i]?.focus();
  const show = (focusFirst = true) => {
    setOpen(true);
    queueMicrotask(() => { positionMenu(); if (focusFirst) focusItem(0); });
  };
  const hide = (refocus = true) => { setOpen(false); if (refocus) toggle.focus(); };
  const onMenuKey = (e: KeyboardEvent) => {
    const els = [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem((i + 1) % els.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem((i - 1 + els.length) % els.length); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(els.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (e.key === 'Tab') hide(false);
  };
  const onDocDown = (e: MouseEvent) => { if (open() && !root.contains(e.target as Node)) hide(false); };
  onMount(() => {
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('resize', positionMenu);
  });
  onCleanup(() => {
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('resize', positionMenu);
  });

  return (
    <div class="aster-tab-new" ref={root}>
      <button
        class="aster-tab-add"
        aria-label={t('tab.menuNew')}
        title={t('tab.new', { key: `${MOD}N` })}
        onClick={() => p.onNew()}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
      <button
        ref={toggle}
        class="aster-tab-more"
        aria-label={t('tab.moreNew')}
        title={t('tab.moreNew')}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => (open() ? hide() : show(false))}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); show(); } }}
      >
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      <Show when={open()}>
        <div ref={menu} class="aster-menu" style={{ left: `${menuLeft()}px` }} role="menu" aria-label={t('tab.moreNew')} onKeyDown={onMenuKey}>
          <Index each={items()}>
            {(it) => (
              <button
                role="menuitem"
                class="aster-menu-item"
                tabIndex={-1}
                onClick={() => { hide(false); it().run(); }}
              >
                <span>{it().label}</span>
                <Show when={it().key}><kbd>{it().key}</kbd></Show>
              </button>
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
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
      <NewTabButton onNew={props.onNew} onOpen={props.onOpen} onSettings={props.onSettings} onExportPdf={props.onExportPdf} />
      <div class="aster-tabs-spacer" {...drag} onDblClick={() => { if (!isMac) props.onNew(); }} />
    </div>
  );
}
