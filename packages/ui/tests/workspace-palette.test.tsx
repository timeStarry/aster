// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { WorkspaceDrawer } from '../src/WorkspaceDrawer';
import { CommandPalette, fuzzyScore } from '../src/CommandPalette';
import { makeTab } from '../src/model';

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  document.body.innerHTML = '';
});

describe('WorkspaceDrawer', () => {
  it('renders folder tree, switches to H1–H6 outline, and jumps on click', () => {
    const mountEl = document.createElement('div');
    document.body.appendChild(mountEl);

    let selectedFile = '';
    let jumpedPos = -1;

    disposers.push(
      render(
        () => (
          <WorkspaceDrawer
            open={true}
            workspaceRoot="/ws"
            tree={[
              {
                name: 'guides',
                path: '/ws/guides',
                relPath: 'guides',
                isDir: true,
                children: [
                  { name: 'intro.md', path: '/ws/guides/intro.md', relPath: 'guides/intro.md', isDir: false },
                ],
              },
              { name: 'README.md', path: '/ws/README.md', relPath: 'README.md', isDir: false },
            ]}
            activePath="/ws/README.md"
            headings={[
              { level: 1, text: 'Overview', from: 0 },
              { level: 2, text: 'Architecture', from: 42 },
            ]}
            cursorPos={50}
            onOpenFolder={() => {}}
            onRefreshFolder={() => {}}
            onCreateFile={() => {}}
            onSelectFile={(p) => { selectedFile = p; }}
            onJumpHeading={(from) => { jumpedPos = from; }}
            onSearchWorkspace={async () => []}
          />
        ),
        mountEl,
      ),
    );

    const fileBtns = mountEl.querySelectorAll('.aster-tree-row.is-file');
    expect(fileBtns.length).toBe(2);
    (fileBtns[0] as HTMLButtonElement).click();
    expect(selectedFile).toBe('/ws/guides/intro.md');

    // Switch to Outline tab
    const tabs = mountEl.querySelectorAll('[role="tab"]');
    (tabs[1] as HTMLButtonElement).click();

    const outlineRows = mountEl.querySelectorAll('.aster-outline-row');
    expect(outlineRows.length).toBe(2);
    expect(outlineRows[1].classList.contains('is-active')).toBe(true);
    (outlineRows[1] as HTMLButtonElement).click();
    expect(jumpedPos).toBe(42);
  });
});

describe('CommandPalette & Quick Switcher', () => {
  it('scores exact, prefix, substring, and subsequence fuzzy matches accurately', () => {
    expect(fuzzyScore('readme', 'README.md')).toBeGreaterThan(fuzzyScore('rmd', 'README.md'));
    expect(fuzzyScore('rmd', 'README.md')).toBeGreaterThan(0);
    expect(fuzzyScore('zzz', 'README.md')).toBe(-1);
  });

  it('dedupes open/recent/workspace files in Quick Open and switches to commands on >', () => {
    const mountEl = document.createElement('div');
    document.body.appendChild(mountEl);

    let ranCmd = '';
    let openedPath = '';
    const openTab = makeTab({ path: '/ws/README.md', content: '# Hi' }, [], 'Untitled');

    disposers.push(
      render(
        () => (
          <CommandPalette
            open={true}
            mode="files"
            focusRev={1}
            tabs={[openTab]}
            recentFiles={['/ws/README.md', '/ws/notes/todo.md']}
            workspaceRoot="/ws"
            workspaceFiles={['/ws/README.md', '/ws/notes/todo.md', '/ws/spec.md']}
            commands={[
              { id: 'theme.paper', label: 'Theme: Paper', run: () => { ranCmd = 'theme.paper'; } },
            ]}
            onSelectTab={() => {}}
            onOpenPath={(p) => { openedPath = p; }}
            onClose={() => {}}
          />
        ),
        mountEl,
      ),
    );

    // 3 unique files (README.md is not duplicated across Open, Recent, and Workspace)
    const initialRows = mountEl.querySelectorAll('.aster-palette-row');
    expect(initialRows.length).toBe(3);

    const input = mountEl.querySelector('.aster-palette-input') as HTMLInputElement;
    input.value = 'spec';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(openedPath).toBe('/ws/spec.md');

    // Typing `> paper` dynamically switches Quick Open into Command Palette mode
    input.value = '> paper';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ranCmd).toBe('theme.paper');
  });
});
