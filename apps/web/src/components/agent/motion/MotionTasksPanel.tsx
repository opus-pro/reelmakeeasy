'use client'

import type { Transcript } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import {
  waitingAnimationTasks,
  waitingMotionTasks,
} from '@reelmakeeasy/common/motion-reel/motion-tasks'
import type { AgentMotionPlan, AgentMotionTask } from '@shared/types/api/agent'
import { cn } from '@shared/ui'
import { useState } from 'react'

import { AgentMarkdown } from '../AgentMarkdown'
import { AgentPlan } from '../AgentPlan'
import { Spinner } from '../Spinner'

/** The phases to show: ReelMakeEasy's last list, else every phase to come (the setup done once
 *  the card is chosen). A list saved before a phase existed (the Review after the Sync check)
 *  shows that phase as waiting, in its place. */
export function shownMotionTasks(transcript: Transcript): AgentMotionTask[] {
  // A Claude Animation shows its own phases in the same panel.
  const animation = transcript.entries.find((e) => e.kind === 'animation_setup')
  const talkingHead = animation?.kind === 'animation_setup' && animation.setup?.lookId === 'avatar'
  const waiting = animation ? () => waitingAnimationTasks(talkingHead) : waitingMotionTasks
  const sent = transcript.motionTasks
  if (sent?.length) {
    const byId = new Map(sent.map((t) => [t.id, t]))
    const known = waiting().map((t) => byId.get(t.id) ?? t)
    return [...known, ...sent.filter((t) => !known.includes(t))]
  }
  const chosen = transcript.entries.some(
    (e) => (e.kind === 'motion_setup' || e.kind === 'animation_setup') && e.state === 'chosen',
  )
  return waiting().map((t) => (t.id === 'setup' && chosen ? { ...t, state: 'done' as const } : t))
}

/** What the agent is doing now, while its turn runs: the chat's working-indicator label. */
export function motionActivityLine(transcript: Transcript): null | string {
  if (!transcript.working) return null
  return transcript.activity?.label ?? 'Working…'
}

/**
 * A Motion Reel chat's Tasks: what the agent is doing right now, the reel's phases (from facts
 * ReelMakeEasy reads, not from the agent's words), its plan (`reel/plan.md`) and the agent's own
 * to-do list. On a narrow window it folds into one line that opens it.
 */
export function MotionTasksPanel({ transcript }: { transcript: Transcript }) {
  const [open, setOpen] = useState(false)
  const tasks = shownMotionTasks(transcript)
  const activity = motionActivityLine(transcript)
  const current =
    tasks.find((t) => t.state === 'running') ??
    tasks.find((t) => t.state === 'failed') ??
    tasks.find((t) => t.state === 'waiting')
  const done = tasks.filter((t) => t.state === 'done').length
  const plan = transcript.plan ?? []
  return (
    <section aria-label="Tasks" className="flex flex-col gap-2 text-xs">
      <button
        aria-expanded={open}
        className="flex items-center gap-2 text-left text-secondary md:hidden"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="font-medium text-primary">Tasks</span>
        <span>
          {done} of {tasks.length} done
        </span>
        <span className="min-w-0 flex-1 truncate">
          {activity ?? (current ? `${current.label}: ${current.result ?? current.state}` : '')}
        </span>
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      <div className={cn('flex-col gap-2 md:flex', open ? 'flex' : 'hidden')}>
        <div className="hidden items-center justify-between text-secondary md:flex">
          <span className="font-medium text-primary">Tasks</span>
          <span>
            {done} of {tasks.length} done
          </span>
        </div>
        {activity && (
          <div className="flex items-center gap-1.5 text-sm text-secondary" role="status">
            <Spinner />
            <span className="min-w-0 truncate">{activity}</span>
          </div>
        )}
        <ol className="flex flex-col gap-1">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ol>
        {transcript.motionPlan && (
          <MotionPlanSection
            // Open while there is no render yet: the plan is what the user decides on.
            defaultOpen={!transcript.entries.some((e) => e.kind === 'motion_video')}
            plan={transcript.motionPlan}
          />
        )}
        {plan.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-white/10 pt-2">
            <span className="text-secondary">The agent's to-do list</span>
            <AgentPlan steps={plan} />
          </div>
        )}
      </div>
    </section>
  )
}

/** The reel's plan as the agent wrote it (`reel/plan.md`), folded once there is a render. */
function MotionPlanSection({ defaultOpen, plan }: { defaultOpen: boolean; plan: AgentMotionPlan }) {
  // null: as the reel stands (open before the first render); the user's own choice after that.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? defaultOpen
  return (
    <div className="flex flex-col gap-1 border-t border-white/10 pt-2" data-section="plan">
      <button
        aria-expanded={open}
        className="flex items-center justify-between text-left text-secondary"
        onClick={() => setChosen(!open)}
        type="button"
      >
        <span className="font-medium text-primary">Plan</span>
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto rounded-md bg-white/5 p-2">
          {plan.text.trim() ? (
            <AgentMarkdown className="text-xs" text={plan.text} />
          ) : (
            <p className="text-secondary">plan.md is empty.</p>
          )}
          {plan.truncated && (
            <p className="mt-1 text-secondary">Only the start of plan.md is shown.</p>
          )}
        </div>
      )}
    </div>
  )
}

function StateIcon({ state }: { state: AgentMotionTask['state'] }) {
  if (state === 'running') return <Spinner className="text-primary" />
  if (state === 'done') return <span className="leading-none text-green-400">✓</span>
  if (state === 'failed') return <span className="leading-none text-red-400">✕</span>
  return <span className="leading-none text-secondary">○</span>
}

const STATE_WORDS: Record<AgentMotionTask['state'], string> = {
  done: 'done',
  failed: 'needs fixing',
  running: 'running',
  waiting: 'waiting',
}

function TaskRow({ task }: { task: AgentMotionTask }) {
  const [open, setOpen] = useState(false)
  const details = task.details ?? []
  const body = (
    <>
      <span className="flex w-3 shrink-0 justify-center pt-0.5">
        <StateIcon state={task.state} />
      </span>
      <span className="sr-only">{STATE_WORDS[task.state]}: </span>
      <span
        className={cn(
          'w-24 shrink-0',
          task.state === 'waiting' ? 'text-secondary' : 'text-primary',
        )}
      >
        {task.label}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          task.state === 'failed' ? 'text-red-400' : 'text-secondary',
        )}
        title={task.result ?? undefined}
      >
        {task.result ?? ''}
      </span>
      {details.length > 0 && (
        <span aria-hidden className="text-secondary">
          {open ? '▴' : '▾'}
        </span>
      )}
    </>
  )
  return (
    <li data-state={task.state} data-task={task.id}>
      {details.length ? (
        <button
          aria-expanded={open}
          className="flex w-full items-start gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2">{body}</div>
      )}
      {open && details.length > 0 && (
        <ul className="my-1 ml-5 flex flex-col gap-0.5 text-secondary">
          {details.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  )
}
