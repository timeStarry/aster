import { createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';
import { StatusBar } from './StatusBar';
import './theme.css';
import type { EditorMode } from '@aster/editor';
import { initPluginLoader } from './plugin-loader';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export default function App() {
  const [content, setContent] = createSignal('# Welcome to Aster\n\nStart writing...\n');
  const [mode, setMode] = createSignal<EditorMode>('live');
  const [wordCount, setWordCount] = createSignal(0);
  let editorRef: { getContent: () => string; setContent: (s: string) => void; view: any } | null = null;
  const onEditorReady = (e: any) => { editorRef = e; };

  createEffect(() => {
    const words = content().trim().split(/\s+/).filter(Boolean).length;
    setWordCount(words);
  });

  onMount(async () => {
    try {
      const plugins = await invoke<unknown[]>('dispatch', { id: 'plugin.list', params: {} }).catch(() => []);
      await initPluginLoader(plugins as any, (_id, path) => path);
    } catch (e) {
      console.error('[aster] plugin loader init failed:', e);
    }

    // Listen for editor.openFile from CLI/MCP
    const unOpenFile = await listen<{ path: string }>('aster://editor/openFile', async (evt) => {
      const { path } = evt.payload;
      try {
        const result = await invoke<{ content: string }>('dispatch', { id: 'doc.read', params: { path } });
        setContent(result.content);
      } catch (e) {
        console.error('[aster] editor.openFile failed:', e);
      }
    });

    // Listen for editor.getSelection and reply with current selection
    const unGetSelection = await listen('aster://editor/getSelection', async () => {
      if (!editorRef) return;
      const view = editorRef.view;
      const sel = view.state.selection.main;
      const selectionContent = view.state.sliceDoc(sel.from, sel.to);
      await (window as any).__aster?.commands.register('__aster.getSelectionReply', () => ({
        anchor: sel.anchor,
        head: sel.head,
        content: selectionContent,
      }));
      // Emit reply back to Rust via event
      const { emit } = await import('@tauri-apps/api/event');
      await emit('aster://editor/selectionResult', {
        anchor: sel.anchor,
        head: sel.head,
        content: selectionContent,
      });
    });

    // Listen for editor.insert
    const unInsert = await listen<{ text: string; position?: number }>('aster://editor/insert', (evt) => {
      if (!editorRef) return;
      const { text, position } = evt.payload;
      const view = editorRef.view;
      const insertPos = position ?? view.state.selection.main.head;
      view.dispatch({ changes: { from: insertPos, insert: text } });
    });

    onCleanup(() => { unOpenFile(); unGetSelection(); unInsert(); });
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
      <TabBar />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <EditorPane
          content={content()}
          mode={mode()}
          onContentChange={setContent}
          onEditorReady={onEditorReady}
        />
      </div>
      <StatusBar wordCount={wordCount()} mode={mode()} onModeChange={setMode} />
    </div>
  );
}
