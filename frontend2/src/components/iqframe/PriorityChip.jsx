const PRIORITY_COLORS = {
  1: '#EF4444',
  2: '#F97316',
  3: '#F59E0B',
  4: '#84CC16',
  5: '#6B7280',
}

export default function PriorityChip({ p, active = false, onClick, interactive = false, className = '' }) {
  const color = PRIORITY_COLORS[p] || PRIORITY_COLORS[5]
  return (
    <button
      onClick={onClick}
      disabled={!interactive}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 'var(--r-pill)',
        fontSize: 11.5,
        fontWeight: 600,
        border: `1px solid ${active ? color : 'var(--line)'}`,
        background: active ? `${color}18` : 'var(--surface)',
        color: active ? color : 'var(--ink-3)',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'all 120ms',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
      P{p}
    </button>
  )
}
