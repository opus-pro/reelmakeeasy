import { logger } from '@reelmakeeasy/common/logger'
import { RenderPlan, Seg, Track } from '@reelmakeeasy/common/types/render-plan-struct'

/** Inline assets (`base64://...`) are media bytes, not structure; never worth a log line. */
const BASE64_URI_PREFIX = 'base64://'

/**
 * Log-only view of a RenderPlan: same structure, but every segment has had its free-text
 * fields removed, so it is not a usable `RenderPlan` and is typed accordingly.
 */
export type RenderPlanLogView = Omit<RenderPlan, 'tracks'> & {
  tracks: Array<Omit<Track<Seg>, 'segs'> & { segs: Array<Record<string, unknown>> }>
}

/**
 * Logs a RenderPlan checkpoint without its free-text payloads. Always go through this helper
 * instead of `logger.info(JSON.stringify(plan))` so caption text can never reach the log sink.
 * Never throws: a logging problem must not fail the render.
 */
export function logRenderPlan(label: string, plan: RenderPlan): void {
  try {
    logger.info(`${label}: ${JSON.stringify(redactRenderPlanForLog(plan))}`)
  } catch (error) {
    logger.warn({ error, label }, 'Failed to log RenderPlan')
  }
}

/**
 * Returns a copy of the RenderPlan that is safe to log: structural fields (ids, timings,
 * uris, style) are kept, free-text payloads are dropped. Caption / text-overlay `texts` are
 * replaced by their count so the shape of the plan is still visible; Lottie template
 * `params` keep their asset references but lose the copy and the descriptions.
 * Both carry transcribed or on-screen speech, which can contain whatever a creator says or
 * shows (emails, phone numbers, addresses).
 */
export function redactRenderPlanForLog(plan: RenderPlan): RenderPlanLogView {
  return {
    ...plan,
    tracks: plan.tracks.map((track) => ({
      ...track,
      segs: track.segs.map((seg) => redactSegForLog(seg)),
    })),
  }
}

function redactSegForLog(seg: Seg): Record<string, unknown> {
  const view = replaceTextsWithCount({ ...seg })
  if (isRecord(view['params'])) {
    view['params'] = redactTemplateParamsForLog(view['params'])
  }
  if (typeof view['uri'] === 'string' && view['uri'].startsWith(BASE64_URI_PREFIX)) {
    view['uri'] = `${BASE64_URI_PREFIX}[omitted]`
  }
  return view
}

/**
 * `ImagesAndTexts` at runtime: `texts` (template copy) is dropped for its count, image and
 * background entries keep uris / crop areas but lose their free-text `desc`.
 */
function redactTemplateParamsForLog(params: Record<string, unknown>): Record<string, unknown> {
  const view = replaceTextsWithCount(params)
  if (Array.isArray(view['images'])) {
    view['images'] = view['images'].map((image: unknown) => omitDesc(image))
  }
  if (view['background'] !== undefined) {
    view['background'] = omitDesc(view['background'])
  }
  return view
}

/** Plan fields are JSON from another service, so the checks are on runtime shape, not types. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function omitDesc(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  const view = { ...value }
  delete view['desc']
  return view
}

function replaceTextsWithCount(record: Record<string, unknown>): Record<string, unknown> {
  const view = { ...record }
  if (Array.isArray(view['texts'])) {
    view['textCount'] = view['texts'].length
    delete view['texts']
  }
  return view
}
