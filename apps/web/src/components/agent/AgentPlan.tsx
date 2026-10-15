'use client'

import type { AgentPlanStep } from '@shared/types/api/agent'
import { cn } from '@shared/ui'

import { Spinner } from './Spinner'

export type AgentPlanProps = {
  steps: AgentPlanStep[]
}

/** Codex's current plan (`turn/plan/updated`) as a compact checklist. */
export function AgentPlan({ steps }: AgentPlanProps) {
  return (
    <ol className="flex flex-col gap-1 text-xs">
      {steps.map((step, index) => (
        <li className="flex items-start gap-2" key={`${index}-${step.step}`}>
          <span className="flex w-3 shrink-0 justify-center pt-0.5">
            {step.status === 'inProgress' ? (
              <Spinner className="text-primary" />
            ) : step.status === 'completed' ? (
              <span className="leading-none text-green-400">✓</span>
            ) : (
              <span className="leading-none text-secondary">○</span>
            )}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1',
              step.status === 'completed' && 'text-secondary line-through',
              step.status === 'inProgress' && 'text-primary',
              step.status === 'pending' && 'text-secondary',
            )}
          >
            {step.step}
          </span>
        </li>
      ))}
    </ol>
  )
}
