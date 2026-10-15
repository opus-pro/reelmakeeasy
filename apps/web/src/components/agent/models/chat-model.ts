import type { ChatModelChoice, ChatModelOption, ChatModelState } from '@shared/types/api/agent'

import type { FetchApiDomain } from '@/hooks/useApi'

const EFFORT_LABEL: Record<string, string> = {
  high: 'High',
  low: 'Low',
  max: 'Max',
  medium: 'Medium',
  minimal: 'Minimal',
  none: 'None',
  ultra: 'Ultra',
  xhigh: 'Extra high',
}

/** A thinking level as people say it (`xhigh` is "Extra high"). */
export function effortLabel(effort: string): string {
  return EFFORT_LABEL[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
}

/** What the picker's button says: the model's name, and its thinking level when set. */
export function choiceLabel(choice: ChatModelChoice | null, models: ChatModelOption[]): string {
  if (!choice) return 'Default model'
  const name = models.find((m) => m.id === choice.model)?.label ?? choice.model
  return choice.effort ? `${name} · ${effortLabel(choice.effort)}` : name
}

/** The choice for a newly picked model: the current thinking level when it takes it, else
 *  medium when it takes that, else the model's own. */
export function switchTo(model: ChatModelOption, current: ChatModelChoice | null): ChatModelChoice {
  const keep = current?.effort && model.efforts.includes(current.effort) ? current.effort : null
  const effort = keep ?? (model.efforts.includes('medium') ? 'medium' : model.defaultEffort)
  return { ...(effort ? { effort } : {}), model: model.id }
}

export const sameChoice = (a: ChatModelChoice | null, b: ChatModelChoice | null): boolean =>
  a?.model === b?.model && (a?.effort ?? null) === (b?.effort ?? null)

async function call(
  fetchApiDomain: FetchApiDomain,
  url: string,
  method: 'GET' | 'PUT',
  data?: object,
): Promise<ChatModelState> {
  const res = await fetchApiDomain<ChatModelState>(url, {
    ...(data === undefined ? {} : { data }),
    method,
    noThrowError: true,
  })
  if (!res.ok || !res.data) throw new Error(res.error || "Couldn't reach the model list")
  return res.data
}

const base = (sessionId: string) => `/api/agent/sessions/${encodeURIComponent(sessionId)}/model`

export const getChatModel = (f: FetchApiDomain, sessionId: string, refresh = false) =>
  call(f, `${base(sessionId)}${refresh ? '?refresh=1' : ''}`, 'GET')

/** Picks the chat's model; null goes back to the default. */
export const setChatModel = (
  f: FetchApiDomain,
  sessionId: string,
  choice: ChatModelChoice | null,
) => call(f, base(sessionId), 'PUT', choice ?? { model: null })

/** Saves the default for every chat on this harness; null clears it. */
export const setDefaultChatModel = (
  f: FetchApiDomain,
  sessionId: string,
  choice: ChatModelChoice | null,
) => call(f, `${base(sessionId)}/default`, 'PUT', choice ?? { model: null })
