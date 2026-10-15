'use client'

import { Button } from '@shared/ui'
import { useState } from 'react'

import { Spinner } from './Spinner'

/** Under a finished video: one button that opens the chat for editing it. */
export function EditCard({ onEdit }: { onEdit: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2">
      <p className="text-sm text-primary">Want to change anything?</p>
      <Button
        className="h-9 shrink-0 rounded-lg px-3"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void onEdit().finally(() => setBusy(false))
        }}
        type="button"
      >
        {busy && <Spinner className="mr-1.5" />}
        Edit this video
      </Button>
    </div>
  )
}
