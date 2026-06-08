const SEV_COLOR = {
  alarm: 'var(--sev-alarm)',
  notify: 'var(--sev-notify)',
  statistic: 'var(--sev-statistic)',
  ok: 'var(--sev-ok)',
  offline: 'var(--sev-offline)',
}

export default function StatusDot({ sev = 'offline', size = 8, pulse = true, className = '' }) {
  const color = SEV_COLOR[sev] || SEV_COLOR.offline
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        display: 'inline-block',
        flexShrink: 0,
        animation: pulse ? 'pulse-dot 2s cubic-bezier(.4,0,.2,1) infinite' : 'none',
      }}
    />
  )
}
