'use client'

import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { cn } from '@shared/ui'
import { useState } from 'react'

import { AgentMarkdown } from './AgentMarkdown'
import { Spinner } from './Spinner'

export type ActivityEntry = Extract<TranscriptEntry, { kind: 'command' | 'thinking' }>
export type ActivityGroupProps = {
  /** A run of consecutive activity entries. */
  entries: ActivityEntry[]
}

type CommandEntry = Extract<TranscriptEntry, { kind: 'command' }>

/** A finished command that failed, or exited non-zero. */
const commandFailed = (entry: CommandEntry) =>
  entry.status === 'failed' ||
  (entry.status === 'completed' && typeof entry.exitCode === 'number' && entry.exitCode !== 0)

function CommandRow({ entry }: { entry: CommandEntry }) {
  const failed = commandFailed(entry)
  return (
    <div className="flex items-start gap-2 font-mono text-xs">
      <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-secondary">
        $ {entry.command}
      </span>
      <span className="flex shrink-0 items-center gap-1 pt-0.5">
        {entry.status === 'started' && <Spinner className="text-secondary" />}
        {entry.status !== 'started' && !failed && <span className="text-green-400">✓</span>}
        {failed && (
          <span className="text-red-400">
            ✕{typeof entry.exitCode === 'number' && ` exit ${entry.exitCode}`}
          </span>
        )}
      </span>
    </div>
  )
}

/** e.g. "Thought, ran 2 commands" (joined with a middle dot), "Thought", "Ran 1 command". */
function summarize(thoughts: number, commands: number): string {
  const parts: string[] = []
  if (thoughts > 0) parts.push('thought')
  if (commands > 0) parts.push(`ran ${commands} command${commands === 1 ? '' : 's'}`)
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Codex's thinking and shell commands between two messages, folded into one
 * line. Expanding shows each thought (as markdown) and each `$ command` with
 * its outcome.
 */
export function ActivityGroup({ entries }: ActivityGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const thoughts = entries.filter((e) => e.kind === 'thinking').length
  const commands = entries.filter((e): e is CommandEntry => e.kind === 'command')
  const failures = commands.filter(commandFailed).length
  const running = entries.some((e) => e.status === 'started')

  return (
    <div className="flex flex-col gap-2">
      <button
        aria-expanded={expanded}
        className="flex w-fit items-center gap-1.5 text-xs text-secondary hover:text-primary"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <span
          aria-hidden
          className={cn('inline-block transition-transform', expanded && 'rotate-90')}
        >
          ›
        </span>
        <span>{summarize(thoughts, commands.length)}</span>
        {running && <Spinner />}
        {failures > 0 && <span className="text-red-400">✕ {failures}</span>}
      </button>
      {expanded && (
        <div className="ml-1.5 flex flex-col gap-2 border-l border-white/10 pl-3">
          {entries.map((entry) =>
            entry.kind === 'thinking' ? (
              entry.text ? (
                <AgentMarkdown
                  className="text-xs text-secondary"
                  key={`thinking-${entry.id}`}
                  text={entry.text}
                />
              ) : (
                <span className="text-xs text-secondary italic" key={`thinking-${entry.id}`}>
                  Thinking…
                </span>
              )
            ) : (
              <CommandRow entry={entry} key={`command-${entry.id}`} />
            ),
          )}
        </div>
      )}
    </div>
  )
}
