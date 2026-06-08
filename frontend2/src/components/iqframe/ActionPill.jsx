const SEV_COLOR = {
  alarm: 'var(--sev-alarm)',
  notify: 'var(--sev-notify)',
  statistic: 'var(--sev-statistic)',
  ok: 'var(--sev-ok)',
  offline: 'var(--sev-offline)',
}

const SEV_BG = {
  alarm: 'var(--sev-alarm-bg)',
  notify: 'var(--sev-notify-bg)',
  statistic: 'var(--sev-statistic-bg)',
  ok: 'var(--sev-ok-bg)',
  offline: 'var(--bg-2)',
}

export default function ActionPill({ action = 'statistic', dot = false, soft = true, children, className = '' }) {
  const color = SEV_COLOR[action] || SEV_COLOR.statistic
  const bg = SEV_BG[action] || SEV_BG.statistic
  const label = children ?? action

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 'var(--r-pill)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        color: soft ? color : '#fff',
        background: soft ? bg : color,
        border: soft ? `1px solid ${color}22` : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color,
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  )
}
