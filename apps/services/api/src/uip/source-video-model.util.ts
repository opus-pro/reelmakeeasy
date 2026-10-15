import type { DebugSettings } from '@shared/types/project/debug-settings'

/**
 * Video (transition) model that "made" a source, for remix carry-over and the
 * premium-model upsell.
 *
 * Visitable sources (owner / share) read `Project.debugSettings
 * .transitionVideoModel` FIRST -- the exact value the badge shows, frozen at
 * confirm, so the carry/upsell always agrees with the badge. `UipSession
 * .transitionVideoModel` is a fallback: it can be null or diverge for a finished
 * project, and reading it alone silently missed real Seedance 2.0 sources (no
 * upsell). null == the Seedance 1.5 default, the full `dreamina-seedance-2-0-*`
 * id == Seedance 2.0 (see planner-api-factory.ts).
 *
 * DEMOS must NEVER read through to the original/source project -- it can be set to
 * expire/be deleted (same reason the `user_uploaded/` storage snapshot exists). The
 * model is snapshotted write-once onto the durable `DemoProject.transitionVideoModel`
 * column at curation; the demo hop reads ONLY that. Best-effort: null on
 * failure, so the carry read never breaks.
 */

/**
 * A resolved source video model plus whether the source was actually READ.
 *
 * `model: null` alone is ambiguous -- it is both "this source ran the default
 * model" and "we found nothing to read" -- and the remix carry needs to tell
 * those apart: the first is a real tier (every badge surface renders a null
 * model as Standard, see resolveModelTierForSurface), the second must leave the
 * composer's selection untouched. `known` is that discriminator: true means a
 * row backing this source was read, so `model` -- null included -- is what the
 * source ran.
 */
export interface SourceVideoModelResolution {
  known: boolean
  model: null | string
}

const UNKNOWN: SourceVideoModelResolution = { known: false, model: null }

interface DemoSourceVideoModelClient {
  demoProject: {
    findUnique: (args: unknown) => Promise<null | { transitionVideoModel: null | string }>
  }
}

interface SourceVideoModelClient {
  project: {
    findUnique: (args: unknown) => Promise<null | { debugSettings: unknown }>
  }
  uipSession: {
    findUnique: (args: unknown) => Promise<null | { transitionVideoModel: null | string }>
  }
}

export async function resolveSourceVideoModel(
  prisma: SourceVideoModelClient,
  projectId: string,
): Promise<SourceVideoModelResolution> {
  try {
    // The badge reads Project.debugSettings.transitionVideoModel (frozen at
    // confirm); read it first so the carry/upsell agrees with the badge.
    const project = await prisma.project.findUnique({
      select: { debugSettings: true },
      where: { id: projectId },
    })
    const fromDebug = (project?.debugSettings as DebugSettings | null | undefined)
      ?.transitionVideoModel
    if (typeof fromDebug === 'string' && fromDebug.length > 0) {
      return { known: true, model: fromDebug }
    }
    // Fallback to the live session selection (e.g. an in-flight project not yet
    // confirmed, where debugSettings hasn't been frozen).
    const session = await prisma.uipSession.findUnique({
      select: { transitionVideoModel: true },
      where: { projectId },
    })
    if (session?.transitionVideoModel) {
      return { known: true, model: session.transitionVideoModel }
    }
    // Neither rail recorded a model. The SESSION row -- not the project row --
    // is the evidence that this source ran the default: the project is created
    // before the session is written, and remix stays available while a project
    // generates, so a project row alone can mean "not recorded YET". Reporting
    // that as a known default would let the composer overwrite a real user
    // selection with Standard. A source with no session row (a project
    // mid-create) stays unknown
    // and the carry leaves the pill alone.
    return session ? { known: true, model: null } : UNKNOWN
  } catch {
    return UNKNOWN
  }
}

/**
 * Demo hop: curated demos fail canVisitProject (no owner/share match) but are
 * public showcases. Their model is snapshotted write-once onto the durable
 * `DemoProject.transitionVideoModel` column at curation -- read ONLY that.
 * The source `Project` is off-limits (it can be deleted/expire, which silently
 * broke the badge and the upsell). Returns unknown for non-demo ids (no
 * disclosure). A demo row whose snapshot is null IS known: null is exactly what
 * that demo's own tier badge renders from, so the carry follows it rather than
 * guessing. Best-effort: unknown on failure.
 */
export async function resolveDemoSourceVideoModel(
  prisma: DemoSourceVideoModelClient,
  demoProjectId: string,
): Promise<SourceVideoModelResolution> {
  try {
    const demo = await prisma.demoProject.findUnique({
      select: { transitionVideoModel: true },
      where: { projectId: demoProjectId },
    })
    return demo ? { known: true, model: demo.transitionVideoModel ?? null } : UNKNOWN
  } catch {
    return UNKNOWN
  }
}
