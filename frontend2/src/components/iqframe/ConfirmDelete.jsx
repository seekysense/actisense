import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ConfirmDelete({ onConfirm, label = 'Delete', size = 'sm' }) {
  const [armed, setArmed] = useState(false)

  if (armed) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <Button variant="ghost" size={size} onClick={() => setArmed(false)}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size={size}
          onClick={() => {
            onConfirm()
            setArmed(false)
          }}
        >
          Confirm delete
        </Button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setArmed(true)}
      title={label}
      className="focus-ring inline-flex items-center justify-center w-[34px] h-[34px] rounded-sm border border-transparent bg-alarm text-white cursor-pointer transition-[filter] duration-150 hover:brightness-90"
    >
      <Trash2 size={18} />
    </button>
  )
}
