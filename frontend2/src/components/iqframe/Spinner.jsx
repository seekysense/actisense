export default function Spinner({ size = 16, color = 'var(--accent)', className = '' }) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        border: `2px solid ${color}33`,
        borderTopColor: color,
        borderRadius: 999,
        display: 'inline-block',
        animation: 'spin 0.7s linear infinite',
      }}
    />
  )
}
