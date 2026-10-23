import type {
  AgentHarnessName,
  ChatModelChoice,
  ChatModelOption,
  ChatModelState,
} from '@shared/types/api/agent'

/**
 * Which model an agent chat runs on. Each harness says which models this user's account can
 * use (Codex's `model/list`, Claude Code's models), and the chat picks one:
 * the one chosen for this chat, else the saved default for the harness, else the recommended
 * one. Recommended: Claude Code's newest Opus; Codex's newest Astra at medium thinking, or its
 * newest Sol at medium thinking on a free, Go or $20 Plus plan (Astra is for bigger plans).
 */

/** What a harness offers: its models, and the plan it reports. */
export interface ChatModelCatalog {
  models: ChatModelOption[]
  plan?: string
}

/** Codex plans that get Sol rather than Astra by default. */
const SMALL_CODEX_PLANS = new Set(['free', 'go', 'plus'])

/** The version in a model id, as numbers to compare (`gpt-6.1-sol` is [6, 1],
 *  `claude-opus-5-5` is [5, 5]), or null when it has none. */
export function modelVersion(id: string, family: string): null | number[] {
  const codex = new RegExp(`^gpt-(\\d+(?:\\.\\d+)*)-${family}$`).exec(id)
  if (codex?.[1]) return codex[1].split('.').map(Number)
  const claude = new RegExp(`^claude-${family}-(\\d+(?:-\\d+)?)$`).exec(id)
  if (claude?.[1]) return claude[1].split('-').map(Number)
  return null
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

/** The newest model of a family (`astra`, `sol`, `opus`), or undefined when there's none. */
export function newestOf(models: ChatModelOption[], family: string): ChatModelOption | undefined {
  return models
    .map((model) => ({ model, version: modelVersion(model.id, family) }))
    .filter((m): m is { model: ChatModelOption; version: number[] } => m.version !== null)
    .sort((a, b) => compareVersions(b.version, a.version))[0]?.model
}

/** Medium thinking when the model takes it, else its own level. */
function atMedium(model: ChatModelOption): ChatModelChoice {
  return model.efforts.includes('medium')
    ? { effort: 'medium', model: model.id }
    : { ...(model.defaultEffort ? { effort: model.defaultEffort } : {}), model: model.id }
}

/** The model a harness's chats use when nothing was chosen, or null when it offers none. */
export function recommendedModel(
  harness: AgentHarnessName,
  catalog: ChatModelCatalog,
): ChatModelChoice | null {
  const { models, plan } = catalog
  if (!models.length) return null
  if (harness === 'claude') {
    const opus = newestOf(models, 'opus')
    return opus ? { model: opus.id } : { model: (models[0] as ChatModelOption).id }
  }
  const small = plan !== undefined && SMALL_CODEX_PLANS.has(plan)
  const pick =
    (small ? undefined : newestOf(models, 'astra')) ??
    newestOf(models, 'sol') ??
    (models[0] as ChatModelOption)
  return atMedium(pick)
}

/** A choice the harness can run (a model it offers, a thinking level that model takes), else
 *  null: a saved pick for a model the account lost falls back to the next one. */
export function usableChoice(
  choice: ChatModelChoice | null | undefined,
  models: ChatModelOption[],
): ChatModelChoice | null {
  if (!choice) return null
  // Not listed yet (the list is still loading): trust it rather than drop the user's pick.
  if (!models.length) return choice
  const model = models.find((m) => m.id === choice.model)
  if (!model) return null
  return choice.effort && model.efforts.includes(choice.effort)
    ? { effort: choice.effort, model: model.id }
    : { model: model.id }
}

/** A chat's model: picked for it, else the saved default, else the recommended one. */
export function chatModelState(input: {
  catalog: ChatModelCatalog | null
  chat?: ChatModelChoice
  harness: AgentHarnessName
  saved?: ChatModelChoice
}): ChatModelState {
  const models = input.catalog?.models ?? []
  const chat = usableChoice(input.chat, models)
  const saved = usableChoice(input.saved, models)
  const recommended = input.catalog ? recommendedModel(input.harness, input.catalog) : null
  const [current, source] = chat
    ? [chat, 'chat' as const]
    : saved
      ? [saved, 'default' as const]
      : recommended
        ? [recommended, 'recommended' as const]
        : [null, 'unknown' as const]
  return {
    current,
    default: saved,
    harness: input.harness,
    models,
    ...(input.catalog?.plan ? { plan: input.catalog.plan } : {}),
    recommended,
    source,
  }
}

/** A `{ model, effort }` from a request body, or null when it isn't one. */
export function parseChoice(body: unknown): ChatModelChoice | null {
  if (!body || typeof body !== 'object') return null
  const { effort, model } = body as Record<string, unknown>
  if (typeof model !== 'string' || !model.trim()) return null
  return {
    ...(typeof effort === 'string' && effort.trim() ? { effort: effort.trim() } : {}),
    model: model.trim(),
  }
}

/** The model family a Motion Reel chat must run on, per harness: Claude Code's Opus, Codex's
 *  Astra. Smaller models write Remotion code that breaks or drifts off the beat. */
export const MOTION_MODEL_FAMILY: Record<AgentHarnessName, string> = {
  claude: 'opus',
  codex: 'astra',
}

/** Thinking levels from least to most; a Motion Reel needs medium or more. */
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const atLeastMedium = (effort: string | undefined) =>
  effort !== undefined && EFFORT_ORDER.indexOf(effort) >= EFFORT_ORDER.indexOf('medium')

/** Whether a model may run a Motion Reel chat on `harness` (its family's newest). */
export function isMotionModel(
  harness: AgentHarnessName,
  models: ChatModelOption[],
  id: string,
): boolean {
  return newestOf(models, MOTION_MODEL_FAMILY[harness])?.id === id
}

/**
 * The model a Motion Reel chat runs on: its family's newest model, at the picked thinking level
 * when that is medium or more, else at medium (or the model's own level when it has no medium).
 * Null when the harness doesn't offer the family to this account.
 */
export function motionModelChoice(
  harness: AgentHarnessName,
  models: ChatModelOption[],
  picked?: ChatModelChoice | null,
): ChatModelChoice | null {
  const model = newestOf(models, MOTION_MODEL_FAMILY[harness])
  if (!model) return null
  if (
    picked?.model === model.id &&
    atLeastMedium(picked.effort) &&
    model.efforts.includes(picked.effort as string)
  )
    return { effort: picked.effort, model: model.id }
  if (model.efforts.includes('medium')) return { effort: 'medium', model: model.id }
  const effort = model.efforts.find(atLeastMedium)
  return effort ? { effort, model: model.id } : atMedium(model)
}

/** Why a harness can't run a Motion Reel for this account, or null when it can. */
export function motionModelGate(
  harness: AgentHarnessName,
  models: ChatModelOption[],
): null | string {
  if (motionModelChoice(harness, models)) return null
  return harness === 'claude'
    ? "Motion Reel needs Claude Opus, and this Claude Code account doesn't offer it."
    : "Motion Reel needs GPT Astra, and this Codex account doesn't offer it (it comes with bigger ChatGPT plans)."
}
