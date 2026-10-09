import { Index } from 'solid-js';
import type { Tab } from './model';
import { MOD } from './model';

interface Props {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function TabBar(props: Props) {
  return (
    <div class="aster-tabs" role="tablist" aria-label="Open documents" onDblClick={(e) => {
      if (e.target === e.currentTarget) props.onNew();
    }}>
      <Index each={props.tabs}>
        {(tab) => (
          <div
            class="aster-tab"
            classList={{ 'is-active': tab().id === props.activeId }}
            role="tab"
            aria-selected={tab().id === props.activeId}
            tabIndex={tab().id === props.activeId ? 0 : -1}
            title={tab().path ?? tab().title}
            onMouseDown={(e) => {
              if (e.button === 1) { e.preventDefault(); props.onClose(tab().id); }
            }}
            onClick={() => props.onSelect(tab().id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') props.onSelect(tab().id); }}
          >
            <span class="aster-tab-title">{tab().title}</span>
            <button
              class="aster-tab-close"
              classList={{ 'is-dirty': tab().dirty }}
              aria-label={`Close ${tab().title}${tab().dirty ? ' (unsaved changes)' : ''}`}
              title={`Close (${MOD}W)`}
              onClick={(e) => { e.stopPropagation(); props.onClose(tab().id); }}
            >
              <span class="dot" />
              <span class="x">✕</span>
            </button>
          </div>
        )}
      </Index>
      <button class="aster-tab-add" aria-label="New tab" title={`New tab (${MOD}N)`} onClick={() => props.onNew()}>+</button>
      <div class="aster-tabs-spacer" onDblClick={() => props.onNew()} />
    </div>
  );
}
