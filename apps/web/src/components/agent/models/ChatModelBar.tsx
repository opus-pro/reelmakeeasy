'use client'

import type { AgentSession, ChatModelOption } from '@shared/types/api/agent'
import { cn, DropdownMenu, type MenuProps } from '@shared/ui'

import { CheckMark, ChevronDownSmall } from '@/components/icons/core'

import { choiceLabel, effortLabel, sameChoice, switchTo } from './chat-model'
import { type ChatModel, useChatModel } from './useChatModel'

const HARNESS_NAME = { claude: 'Claude Code', codex: 'Codex' } as const

const ROW =
  'cursor-pointer rounded-sm px-2.5 py-1.5 text-sm text-primary data-[highlighted]:bg-fill-hover focus:bg-fill-hover data-[highlighted]:text-primary focus:text-primary data-[state=open]:bg-fill-hover data-[state=open]:text-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

/** A model row's name, marked when the chat runs on it (a row with thinking levels shows its
 *  submenu arrow where a plain row shows its check). */
function ModelName({ current, label }: { current: boolean; label: string }) {
  return (
    <span className="flex w-full items-center justify-between gap-3">
      <span className={current ? 'font-semibold' : undefined}>{label}</span>
      {current && <CheckMark className="size-3.5 text-primary" />}
    </span>
  )
}

/** The menu's rows: each model (a submenu of thinking levels when it has them), then the
 *  default's actions. */
export function modelMenuItems(model: ChatModel, harnessName: string): MenuProps[] {
  const state = model.state
  if (!state) return []
  const { current } = state
  const rows: MenuProps[] = state.models.map((option: ChatModelOption) => {
    const checked = current?.model === option.id
    if (!option.efforts.length)
      return {
        checked,
        className: ROW,
        key: option.id,
        label: option.label,
        onClick: () => void model.pick(switchTo(option, current)),
      }
    return {
      checked,
      children: option.efforts.map((effort) => ({
        checked: checked && current?.effort === effort,
        className: ROW,
        key: `${option.id}:${effort}`,
        label: effortLabel(effort),
        onClick: () => void model.pick({ effort, model: option.id }),
      })),
      className: ROW,
      key: option.id,
      label: <ModelName current={checked} label={option.label} />,
    }
  })
  const isDefault = state.source === 'default' || sameChoice(current, state.default)
  return [
    ...rows,
    { key: 'sep', type: 'separator' },
    {
      className: ROW,
      disabled: !current || isDefault,
      key: 'set-default',
      label: isDefault ? `Default for ${harnessName}` : `Set as default for ${harnessName}`,
      onClick: () => void model.setDefault(current),
    },
    ...(state.default
      ? [
          {
            className: ROW,
            key: 'clear-default',
            label: `Clear default (use ${choiceLabel(state.recommended, state.models)})`,
            onClick: () => void model.setDefault(null),
          },
        ]
      : []),
    {
      className: ROW,
      key: 'refresh',
      label: 'Check models again',
      onClick: () => void model.refresh(),
    },
  ]
}

/**
 * The model picker under every chat's box, whatever its mode (and before one is chosen):
 * what the chat runs on (e.g. "Opus 5.5, Medium"), every model its harness offers this
 * account, and "Set as default".
 */
export function ChatModelBar({ session }: { session: AgentSession | null | undefined }) {
  const model = useChatModel(session?.id, !!session, `${session?.harness}:${session?.mode}`)
  if (!session) return null
  const harnessName = HARNESS_NAME[session.harness ?? 'codex']
  const state = model.state
  const label = state ? choiceLabel(state.current, state.models) : 'Loading models...'
  return (
    <div className="flex items-center justify-end gap-2 px-3 pb-2">
      {model.error && <span className="truncate text-[11px] text-red-400">{model.error}</span>}
      <DropdownMenu
        align="end"
        classNames={{
          content:
            'bg-menu-background backdrop-blur-2xl min-w-56 rounded-xl border border-white/10 p-1 text-primary',
          subContent:
            'bg-menu-background backdrop-blur-2xl min-w-36 rounded-xl border border-white/10 p-1 text-primary',
        }}
        items={modelMenuItems(model, harnessName)}
        label={state?.plan ? `${harnessName} · ${state.plan} plan` : harnessName}
        side="top"
        triggerDisabled={!state?.models.length}
      >
        <button
          aria-label={`Model: ${label}`}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs text-secondary hover:bg-white/5 hover:text-primary',
            model.busy && 'opacity-60',
          )}
          type="button"
        >
          {label}
          {state?.source === 'default' && (
            <span className="text-[10px] text-secondary/70">(default)</span>
          )}
          <ChevronDownSmall className="size-3.5" />
        </button>
      </DropdownMenu>
    </div>
  )
}
