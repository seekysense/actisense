const SEV_COLOR = {
  alarm: 'var(--sev-alarm)',
  notify: 'var(--sev-notify)',
  statistic: 'var(--sev-statistic)',
  ok: 'var(--sev-ok)',
  offline: 'var(--sev-offline)',
}

const SEV_TINT = {
  alarm: 'rgba(239,68,68,0.035)',
  notify: 'rgba(245,158,11,0.04)',
  ok: 'rgba(16,185,129,0.03)',
  statistic: 'var(--surface)',
  offline: 'var(--surface)',
}

export default function SevCard({ sev, accentBar = true, hover = false, onClick, children, className = '' }) {
  const color = sev ? SEV_COLOR[sev] : null
  const tint = sev ? SEV_TINT[sev] || 'var(--surface)' : 'var(--surface)'

  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: sev && sev !== 'statistic' ? tint : 'var(--surface)',
        border: '1px solid var(--line)',
        borderLeft: sev && accentBar ? `4px solid ${color}` : '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 160ms, transform 160ms',
      }}
      onMouseEnter={
        hover
          ? (e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-lg)'
            }
          : undefined
      }
      onMouseLeave={
        hover
          ? (e) => {
              e.currentTarget.style.boxShadow = 'none'
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
