/**
 * Cost metering for fal.ai generations invoked directly via the fal client
 * (`fal.subscribe` / `fal.queue`) instead of through the model registry
 * (libs/llm).
 *
 * It prices the generation in nano-dollars from a small local rate map keyed
 * by fal endpoint. It is a best-effort side-effect - it never throws.
 *
 * The per-project cost roll-up (`recordProjectNotificationCost`) is OPT-IN via
 * `recordProjectCost`: the avatar-tool and ideogram paths already feed
 * the project-notification budget through `reportCost`, so they leave it unset to
 * avoid a double-count; the paths that use this helper ALONE (flux-2-pro/edit,
 * kling lip-sync, VEED avatar scene-submit) set it so their spend still reaches
 * the only per-project cost sink.
 */
import { getLogger } from '../logger'
import { recordProjectNotificationCost } from '../pricing/project-notification-cost'
import { nanoDollar } from '../utils/cost'

const logger = getLogger('fal-direct-cost')

/** Provider tag value - the entity fal.ai actually bills us as. */
const FAL_PROVIDER = 'fal'
/** Default `biz` tag when a caller omits it. */
export const DEFAULT_FAL_DIRECT_BIZ = 'E2E-Video'

type FalDirectRate =
  | { billingIncrementSeconds?: number; unit: 'second'; usdPerSecond: number }
  | { unit: 'image'; usdPerImage: number }
  | { unit: 'megapixel'; usdAdditionalMp: number; usdFirstMp: number }

/**
 * Published fal.ai per-endpoint rates (USD), as of 2026-07. Keep these in sync
 * with each endpoint's fal pricing page when they change. Per-second video
 * endpoints price on duration; per-image endpoints price per output image;
 * per-megapixel endpoints price on the output image area.
 */
export const FAL_DIRECT_RATES: Record<string, FalDirectRate> = {
  // FLUX.2 [pro] edit - $0.03 for the first output megapixel, then $0.015 per
  // additional megapixel (fal published rate). Priced on the actual output
  // dimensions because preset ratios (e.g. 16:9 -> 1920x1080, ~2.07 MP) exceed
  // one megapixel while custom-ratio outputs stay near ~1 MP.
  'fal-ai/flux-2-pro/edit': { unit: 'megapixel', usdAdditionalMp: 0.015, usdFirstMp: 0.03 },
  // Ideogram V3 Reframe - $0.06 / image (2 quality units x $0.03; matches the
  // existing `reportCost` used in ideogramProcessor).
  'fal-ai/ideogram/v3/reframe': { unit: 'image', usdPerImage: 0.06 },
  // Kling lip-sync (audio-to-video) - $0.014 per input video-second, billed up
  // to the nearest 5-second increment (fal published rate).
  'fal-ai/kling-video/lipsync/audio-to-video': {
    billingIncrementSeconds: 5,
    unit: 'second',
    usdPerSecond: 0.014,
  },
  // VEED Fabric 1.0 talking-head avatar - $0.08 / output-second at 480p
  // (matches the avatar reporter priceConfig; RESOLUTION is pinned to 480p).
  'veed/fabric-1.0': { unit: 'second', usdPerSecond: 0.08 },
}

/**
 * Cost in nano-dollars for one fal-direct generation, or 0 when the endpoint is
 * unknown or the usage figures are non-positive (nothing to meter).
 */
export function falDirectCostNano(
  endpoint: string,
  usage: { images?: number; megapixels?: number; seconds?: number },
): number {
  const rate = FAL_DIRECT_RATES[endpoint]
  if (!rate) {
    return 0
  }
  if (rate.unit === 'second') {
    const seconds = Number.isFinite(usage.seconds) ? Math.max(0, usage.seconds as number) : 0
    if (seconds <= 0) {
      return 0
    }
    const increment = rate.billingIncrementSeconds ?? 1
    const billableSeconds = Math.ceil(seconds / increment) * increment
    return Math.round(billableSeconds * nanoDollar(rate.usdPerSecond, 1))
  }
  if (rate.unit === 'megapixel') {
    // Default to a single megapixel when the output area is unknown, so the
    // generation still meters at the first-megapixel rate rather than 0.
    const megapixels =
      Number.isFinite(usage.megapixels) && (usage.megapixels as number) > 0
        ? (usage.megapixels as number)
        : 1
    // fal rounds output area to whole megapixels: a 1024x1024 (~1.05 MP) image
    // bills as one, a 1920x1080 (~2.07 MP) image bills as two.
    const billedMp = Math.max(1, Math.round(megapixels))
    return Math.round(
      nanoDollar(rate.usdFirstMp, 1) + (billedMp - 1) * nanoDollar(rate.usdAdditionalMp, 1),
    )
  }
  const images = Number.isFinite(usage.images) ? Math.max(0, Math.round(usage.images as number)) : 1
  if (images <= 0) {
    return 0
  }
  return Math.round(images * nanoDollar(rate.usdPerImage, 1))
}

/**
 * Record the cost of a fal-direct generation that resolved successfully.
 * Best-effort: swallows all errors so cost tracking can never break
 * the generation flow (safe to call inside an activity as a
 * post-return side-effect).
 */
export function reportFalDirectCost(params: {
  biz?: string
  endpoint: string
  images?: number
  megapixels?: number
  projectId?: string
  recordProjectCost?: boolean
  seconds?: number
  task: string
}): void {
  try {
    const costNano = falDirectCostNano(params.endpoint, {
      images: params.images,
      megapixels: params.megapixels,
      seconds: params.seconds,
    })
    if (costNano <= 0) {
      return
    }
    // Opt-in feed of the per-project cost roll-up. Only paths that do
    // NOT also go through `reportCost` set `recordProjectCost` (see the module
    // header), keeping the per-project total complete without double-counting.
    // projectId falls back to the ambient JobContext when omitted.
    if (params.recordProjectCost) {
      recordProjectNotificationCost({
        costNano,
        model: params.endpoint,
        projectId: params.projectId,
        provider: FAL_PROVIDER,
        task: params.task,
      })
    }
  } catch (error) {
    logger.warn({ endpoint: params.endpoint, error }, 'Failed to emit fal-direct provider cost')
  }
}
