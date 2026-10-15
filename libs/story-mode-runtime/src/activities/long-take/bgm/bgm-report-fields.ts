import { LONG_TAKE_WORLD_BIBLE_PATH } from '../../long-take-experts-analysis'
import { LONG_TAKE_GLOBAL_CONSTRAINTS_PATH } from '../storage'

import type { BgmReportFields } from './bgm-director'

type JsonReader = { readJsonFile<T>(path: string): Promise<T> }

type WorldBible = { global_context?: Record<string, unknown>; thematic_core?: string }

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
const list = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

/**
 * What the experts stage and the planner wrote, as far as it exists: the director copes
 * with any subset, so a missing world bible (a degraded run) still yields a bed from the
 * style and the user's wish.
 */
export async function readBgmReportFields(
  storage: JsonReader,
  base: Pick<
    BgmReportFields,
    | 'cameraStyle'
    | 'durationSec'
    | 'numShots'
    | 'numTransitions'
    | 'styleName'
    | 'styleText'
    | 'userRequest'
  > & { hasVoiceover?: boolean },
): Promise<BgmReportFields> {
  const bible = await storage.readJsonFile<WorldBible>(LONG_TAKE_WORLD_BIBLE_PATH).catch(() => null)
  const constraints = await storage
    .readJsonFile<Record<string, unknown>>(LONG_TAKE_GLOBAL_CONSTRAINTS_PATH)
    .catch(() => null)
  const gc = bible?.global_context ?? {}
  // video_type is the closest high-level signal for the director's "useCase".
  const videoType = str(gc.video_type) ?? str(constraints?.video_type)
  const fields: BgmReportFields = {
    brandScope: str(constraints?.brand_scope),
    keyEntities: list(gc.key_entities) ?? list(constraints?.key_entities),
    scriptCategory: str(gc.script_category) ?? str(constraints?.script_category),
    targetAudience: str(constraints?.target_audience),
    thematicCore: str(bible?.thematic_core),
    tone: str(gc.tone) ?? str(constraints?.tone),
    topic: str(gc.topic) ?? str(constraints?.topic),
    useCase: videoType,
    videoType,
    ...base,
    // After the spread: a caller passing `hasVoiceover: undefined` still means "yes".
    hasVoiceover: base.hasVoiceover ?? true,
  }
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as BgmReportFields
}
