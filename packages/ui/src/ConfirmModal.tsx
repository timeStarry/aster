import { For, onMount, onCleanup } from 'solid-js';

export interface ConfirmButton {
  id: string;
  label: string;
  kind?: 'primary' | 'danger';
}

export interface ConfirmRequest {
  title: string;
  message: string;
  buttons: ConfirmButton[];
  /** Button id returned on Escape / backdrop click. */
  cancelId: string;
  resolve: (id: string) => void;
}

export function ConfirmModal(props: { req: ConfirmRequest }) {
  let primary: HTMLButtonElement | undefined;
  const done = (id: string) => props.req.resolve(id);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); done(props.req.cancelId); }
  };
  onMount(() => {
    primary?.focus();
    window.addEventListener('keydown', onKey, true);
  });
  onCleanup(() => window.removeEventListener('keydown', onKey, true));

  return (
    <div class="aster-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) done(props.req.cancelId); }}>
      <div class="aster-modal" role="alertdialog" aria-modal="true" aria-labelledby="aster-confirm-title" aria-describedby="aster-confirm-msg">
        <h2 id="aster-confirm-title">{props.req.title}</h2>
        <p id="aster-confirm-msg" style={{ 'font-size': '13px', color: 'var(--fg-muted)', 'line-height': '1.5' }}>{props.req.message}</p>
        <div class="aster-actions">
          <For each={props.req.buttons}>
            {(b) => (
              <button
                ref={(el) => { if (b.kind === 'primary') primary = el; }}
                class="aster-btn"
                classList={{ primary: b.kind === 'primary', danger: b.kind === 'danger' }}
                onClick={() => done(b.id)}
              >{b.label}</button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
