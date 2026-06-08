import { cn } from '@/lib/utils'

export default function EmptyState({ icon: Icon, title, hint, action, className = '' }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-14 px-6 text-center gap-1.5', className)}>
      <div className="w-14 h-14 rounded-md bg-bg-2 flex items-center justify-center mb-2">
        {Icon && <Icon size={28} className="text-ink-4" strokeWidth={1.5} />}
      </div>
      <div className="text-sm font-semibold text-ink-1">{title}</div>
      {hint && <div className="text-[13px] text-ink-3 max-w-[320px] leading-relaxed">{hint}</div>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  )
}
