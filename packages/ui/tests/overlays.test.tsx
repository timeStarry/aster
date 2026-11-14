// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { createEditor } from '@aster/editor';
import { filterSlashItems, SlashMenu } from '../src/SlashMenu';
import { FindBar } from '../src/FindBar';

// jsdom lacks layout geometry methods expected by CodeMirror's LayerView
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
}

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  document.body.innerHTML = '';
});

describe('SlashMenu filtering & zero-interference', () => {
  it('filters commands by English keyword and Chinese label, and returns empty for paths like Users', () => {
    expect(filterSlashItems('').length).toBeGreaterThanOrEqual(10);
    expect(filterSlashItems('math').some((i) => i.id === 'math')).toBe(true);
    expect(filterSlashItems('表格').some((i) => i.id === 'table')).toBe(true);
    expect(filterSlashItems('流程图').some((i) => i.id === 'mermaid')).toBe(true);
    // Unrecognized path segment like `Users` yields 0 matches so menu auto-dismisses
    expect(filterSlashItems('Users')).toHaveLength(0);
  });

  it('inserts the selected block and removes /query on Enter', () => {
    const main = document.createElement('div');
    main.className = 'aster-main';
    const host = document.createElement('div');
    const mountEl = document.createElement('div');
    main.append(host, mountEl);
    document.body.appendChild(main);

    const ed = createEditor(host, { initialContent: '/h2' });
    disposers.push(() => ed.destroy());

    let closed = false;
    disposers.push(
      render(
        () => (
          <SlashMenu
            view={() => ed.view}
            trigger={{ lineFrom: 0, lineTo: 3, query: 'h2' }}
            onClose={() => { closed = true; }}
          />
        ),
        mountEl,
      ),
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ed.getContent()).toBe('## ');
    expect(closed).toBe(true);
  });
});

describe('FindBar floating search & replace', () => {
  it('highlights matches, shows live count, replaces occurrences, and closes on Escape', () => {
    const host = document.createElement('div');
    const mountEl = document.createElement('div');
    document.body.append(host, mountEl);
    const ed = createEditor(host, { initialContent: 'alpha beta alpha gamma' });
    disposers.push(() => ed.destroy());

    let closed = false;
    disposers.push(
      render(
        () => (
          <FindBar
            open={true}
            showReplace={true}
            readOnly={false}
            initialQuery="alpha"
            docRev={1}
            focusRev={1}
            view={() => ed.view}
            onToggleReplace={() => {}}
            onClose={() => { closed = true; }}
          />
        ),
        mountEl,
      ),
    );

    expect(mountEl.querySelector('.aster-find-count')?.textContent).toBe('1/2');

    const inputs = mountEl.querySelectorAll('input.aster-find-input');
    expect(inputs.length).toBe(2);
    const replaceInput = inputs[1] as HTMLInputElement;
    replaceInput.value = 'omega';
    replaceInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    replaceInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }),
    );

    expect(ed.getContent()).toBe('omega beta omega gamma');

    mountEl
      .querySelector('.aster-find-bar')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(closed).toBe(true);
  });
});
