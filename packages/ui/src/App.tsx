import { createSignal, onMount, createEffect } from 'solid-js';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';
import { StatusBar } from './StatusBar';
import './theme.css';
import type { EditorMode } from '@aster/editor';
import { initPluginLoader } from './plugin-loader';
import { invoke } from '@tauri-apps/api/core';

export default function App() {
  const [content, setContent] = createSignal('# Welcome to Aster\n\nStart writing...\n');
  const [mode, setMode] = createSignal<EditorMode>('live');
  const [wordCount, setWordCount] = createSignal(0);

  createEffect(() => {
    const words = content().trim().split(/\s+/).filter(Boolean).length;
    setWordCount(words);
  });

  onMount(async () => {
    try {
      const plugins = await invoke<unknown[]>('dispatch', { id: 'plugin.list', params: {} }).catch(() => []);
      // resolvePluginUrl is a stub for M3; real asset-protocol URLs come in M4
      await initPluginLoader(plugins as any, (_id, path) => path);
    } catch (e) {
      console.error('[aster] plugin loader init failed:', e);
    }
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
      <TabBar />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <EditorPane
          content={content()}
          mode={mode()}
          onContentChange={setContent}
        />
      </div>
      <StatusBar wordCount={wordCount()} mode={mode()} onModeChange={setMode} />
    </div>
  );
}
