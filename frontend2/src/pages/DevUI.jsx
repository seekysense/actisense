import {
  LayoutDashboard,
  CalendarX,
  Terminal,
  Trash2,
  AlertTriangle,
} from 'lucide-react'

import Logo from '@/components/iqframe/Logo'
import StatusDot from '@/components/iqframe/StatusDot'
import ActionPill from '@/components/iqframe/ActionPill'
import PriorityChip from '@/components/iqframe/PriorityChip'
import SevCard from '@/components/iqframe/SevCard'
import EmptyState from '@/components/iqframe/EmptyState'
import ConfirmDelete from '@/components/iqframe/ConfirmDelete'
import Spinner from '@/components/iqframe/Spinner'

function Section({ title, children }) {
  return (
    <div className="mb-10">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-3 mb-4">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

export default function DevUI() {
  return (
    <div className="min-h-screen bg-bg p-8">
      <h1 className="text-2xl font-semibold mb-8">IQFrame — Design System Primitives</h1>

      <Section title="Logo">
        <Logo size={32} />
        <Logo size={48} />
        <Logo size={64} />
      </Section>

      <Section title="StatusDot">
        <StatusDot sev="ok" pulse />
        <StatusDot sev="alarm" pulse />
        <StatusDot sev="notify" pulse />
        <StatusDot sev="statistic" />
        <StatusDot sev="offline" />
        <StatusDot sev="ok" size={12} pulse />
      </Section>

      <Section title="ActionPill">
        <ActionPill action="alarm" dot />
        <ActionPill action="notify" dot />
        <ActionPill action="statistic" dot />
        <ActionPill action="ok" dot />
        <ActionPill action="alarm" soft={false} />
        <ActionPill action="notify">Custom label</ActionPill>
      </Section>

      <Section title="PriorityChip">
        {[1, 2, 3, 4, 5].map((p) => (
          <PriorityChip key={p} p={p} />
        ))}
        {[1, 2, 3].map((p) => (
          <PriorityChip key={`a-${p}`} p={p} active interactive />
        ))}
      </Section>

      <Section title="SevCard">
        <SevCard sev="alarm" className="p-4 w-48">
          <div className="text-sm font-medium">Alarm card</div>
          <div className="text-xs text-ink-3 mt-1">Border left red</div>
        </SevCard>
        <SevCard sev="notify" className="p-4 w-48">
          <div className="text-sm font-medium">Notify card</div>
          <div className="text-xs text-ink-3 mt-1">Border left amber</div>
        </SevCard>
        <SevCard sev="ok" className="p-4 w-48">
          <div className="text-sm font-medium">OK card</div>
          <div className="text-xs text-ink-3 mt-1">Border left green</div>
        </SevCard>
        <SevCard sev="statistic" className="p-4 w-48">
          <div className="text-sm font-medium">Statistic card</div>
          <div className="text-xs text-ink-3 mt-1">No accent</div>
        </SevCard>
        <SevCard sev="alarm" hover className="p-4 w-48">
          <div className="text-sm font-medium">Hover me</div>
          <div className="text-xs text-ink-3 mt-1">Hover shadow</div>
        </SevCard>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          icon={CalendarX}
          title="No events"
          hint="There are no events in the selected time range."
        />
        <EmptyState
          icon={Terminal}
          title="No logs"
          hint="Engine logs will appear here."
          action={<button className="text-accent text-sm font-medium">Refresh</button>}
        />
      </Section>

      <Section title="ConfirmDelete">
        <ConfirmDelete onConfirm={() => alert('Deleted!')} />
      </Section>

      <Section title="Spinner">
        <Spinner />
        <Spinner size={24} />
        <Spinner size={32} color="var(--sev-alarm)" />
        <Spinner size={40} color="var(--sev-notify)" />
      </Section>

      <Section title="Lucide icons (reference)">
        <LayoutDashboard size={20} strokeWidth={1.75} />
        <AlertTriangle size={20} strokeWidth={1.75} />
        <Trash2 size={20} strokeWidth={1.75} />
      </Section>
    </div>
  )
}
