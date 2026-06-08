export default function Logo({ className = '', size = 40, alt = 'IQFrame' }) {
  return (
    <img
      src="/logo.svg"
      alt={alt}
      className={className}
      style={{ height: size, width: 'auto' }}
    />
  )
}
