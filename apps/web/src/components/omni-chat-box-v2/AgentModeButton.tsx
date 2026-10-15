'use client'

import { Button, cn } from '@shared/ui'

import { useAgentPicker } from '@/components/agent/AgentPickerDialog'

/**
 * Beside the Send button. Always enabled: a click opens the Agent dialog (Codex or Claude
 * Code, each marked ready or not); picking a ready one starts a chat on it and opens it.
 * The navigation is a full page load: /agent is cross-origin isolated (for the
 * editor engine's video preview) only when its document is loaded with its own
 * headers, which a client-side navigation from here skips.
 */
export function AgentModeButton() {
  const { openPicker, picker, starting } = useAgentPicker({ hard: true })
  return (
    <>
      <Button
        className={cn(
          'h-9.5 gap-1.5 rounded-full bg-transparent px-2.5 py-0 text-sm font-medium leading-[17px] text-white transition-colors hover:bg-fill-secondary',
        )}
        disabled={starting}
        onClick={openPicker}
      >
        {starting ? 'Opening…' : 'Agent'}
      </Button>
      {picker}
    </>
  )
}
