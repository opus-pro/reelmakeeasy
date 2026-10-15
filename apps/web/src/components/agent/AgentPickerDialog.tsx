'use client'

import type { AgentHarnessName, AgentStatusResponse } from '@shared/types/api/agent'
import { cn, Dialog } from '@shared/ui'
import { useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'

import { agentPickerRows, anyHarnessReady } from './agent-harness'
import { Spinner } from './Spinner'
import { useStartAgentSession } from './useStartAgentSession'

const LAST_HARNESS_KEY = 'reelmakeeasy.agent.harness'

/** The agent picked last time, to highlight it (per browser; empty when storage is blocked). */
function lastHarness(): AgentHarnessName | null {
  try {
    const value = localStorage.getItem(LAST_HARNESS_KEY)
    return value === 'claude' || value === 'codex' ? value : null
  } catch {
    return null
  }
}

function rememberHarness(harness: AgentHarnessName): void {
  try {
    localStorage.setItem(LAST_HARNESS_KEY, harness)
  } catch {
    // Storage blocked: the dialog just won't highlight it next time.
  }
}

/**
 * "Choose your agent": Codex and Claude Code, each ready (a check) or greyed out with what to
 * do. Picking a ready one starts a chat on it, so its mode card doesn't ask again.
 */
function AgentPickerDialog({
  onClose,
  onPick,
  starting,
}: {
  onClose: () => void
  onPick: (harness: AgentHarnessName) => void
  starting: boolean
}) {
  const { fetchApiDomain } = useApi()
  const [status, setStatus] = useState<AgentStatusResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [last] = useState(lastHarness)

  useEffect(() => {
    let cancelled = false
    fetchApiDomain<AgentStatusResponse>('/api/agent/status?refresh=1', { method: 'GET' })
      .then(({ data }) => {
        if (!cancelled) setStatus(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [fetchApiDomain])

  const rows = agentPickerRows(failed ? null : status)
  return (
    <Dialog
      classNames={{
        content:
          'flex w-[400px] max-w-[calc(100vw-32px)] flex-col gap-4 rounded-2xl border-none bg-menu-background p-5 backdrop-blur-2xl',
        overlay: 'bg-black/75 backdrop-blur-[2px]',
      }}
      footer={null}
      header={null}
      onCancel={onClose}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-primary">Choose your agent</h2>
        <p className="text-xs text-secondary">
          It runs on this computer with your own sign-in. A chat keeps the agent it starts with.
        </p>
      </div>
      <div className="flex flex-col gap-1.5" role="radiogroup">
        {rows.map((row) => {
          const ready = row.state === 'ready'
          return (
            <button
              aria-checked={ready && last === row.harness}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2.5 text-left transition-colors',
                'disabled:cursor-not-allowed',
                ready && 'hover:border-white/30 hover:bg-white/5',
                !ready && 'opacity-50',
              )}
              disabled={!ready || starting}
              key={row.harness}
              onClick={() => onPick(row.harness)}
              role="radio"
              type="button"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold text-primary">
                  {row.label}
                  {ready && last === row.harness && (
                    <span className="ml-2 text-xs font-normal text-secondary">Last used</span>
                  )}
                </span>
                {row.reason && (
                  <span className="text-xs break-words text-secondary">{row.reason}</span>
                )}
              </span>
              {row.state === 'checking' && !failed && <Spinner className="text-secondary" />}
              {ready && <span className="text-xs font-medium text-accent-green">✓ Ready</span>}
              {row.state === 'unavailable' && (
                <span className="text-xs text-secondary">Unavailable</span>
              )}
            </button>
          )
        })}
      </div>
      {failed && (
        <p className="text-xs text-secondary">
          Couldn't check the agents. Make sure ReelMakeEasy is running, then try again.
        </p>
      )}
      {status && !anyHarnessReady(status) && (
        <p className="text-xs text-secondary">Install Codex or Claude Code to use Agent mode.</p>
      )}
    </Dialog>
  )
}

/** The Agent dialog for a "start a chat" button: `openPicker` shows it, `picker` renders it.
 *  A pick closes it and starts the chat (the button shows it opening); a click while a chat is
 *  starting does nothing, so one pick is one chat. */
export function useAgentPicker({ hard }: { hard: boolean }) {
  const { start, starting } = useStartAgentSession({ hard })
  const [open, setOpen] = useState(false)
  const picker = open ? (
    <AgentPickerDialog
      onClose={() => setOpen(false)}
      onPick={(harness) => {
        setOpen(false)
        rememberHarness(harness)
        void start(harness)
      }}
      starting={starting}
    />
  ) : null
  return {
    openPicker: () => {
      if (!starting) setOpen(true)
    },
    picker,
    starting,
  }
}
