export function TabBar() {
  return (
    <div style={{
      display: 'flex',
      'align-items': 'center',
      background: 'var(--tab-bg)',
      'border-bottom': '1px solid var(--border)',
      height: '36px',
      padding: '0 8px',
      gap: '4px',
    }}>
      <span style={{
        padding: '4px 12px',
        background: 'var(--tab-active)',
        'border-radius': '4px 4px 0 0',
        'font-size': '13px',
        cursor: 'default',
      }}>
        Untitled.md
      </span>
    </div>
  );
}
