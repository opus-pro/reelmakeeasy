import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { BadRequestException } from '@nestjs/common'

import { findBriefSavedFromSource } from '../brand-briefs/brand-brief-auto-save'

import { resolveDemoSourceImageModel, resolveSourceImageModel } from './dominant-image-model.util'
import { summarizeRemixSource } from './remix-context-summarizer'
import { resolveDemoSourceVideoModel, resolveSourceVideoModel } from './source-video-model.util'

interface CarryUipContextDeps {
  prisma: unknown
  projectService: {
    canViewProject: (projectId: string, shareId?: string) => Promise<boolean>
    isProjectOwnedByRequester: (projectId: string) => Promise<boolean>
  }
}

/**
 * Validate a spec-recorded brief id against the live library: the row must
 * still exist and belong to the requester's org. A deleted/foreign brief
 * resolves null -- the FE then empties the selector, and the carry
 * qualification suppresses on spec provenance, so a deleted brand's bank is
 * never resurrected.
 */
async function resolveLiveBriefId(
  prisma: {
    brandBrief: {
      findUnique: (args: { where: { id: string } }) => Promise<null | { orgId: null | string }>
    }
  },
  briefId: null | string | undefined,
): Promise<null | string> {
  if (!briefId) {
    return null
  }
  const brief = await prisma.brandBrief.findUnique({ where: { id: briefId } })
  const reqCtx = getReqContext()
  return brief?.orgId && brief.orgId === reqCtx.org_id ? briefId : null
}

/**
 * Read-only carry-over preview for the Remix flow. Given a source project,
 * returns the deterministic bullet summary the Omni composer prefills above
 * the user's prompt -- no session is created. Carry-over is best-effort: a
 * non-viewable source (`canViewProject` false) yields null rather than
 * erroring, matching createUipSession. Also returns the image model (explicit
 * selection or dominant keyframe model) and the video/transition model
 * (explicit selection only) that made the source, so the composer's model
 * panel can follow suit and the premium-model upsell can gate the remix.
 * `video_model_known` says whether the source's model was actually SETTLED --
 * an explicit record, or a session row proving none was picked -- which is what
 * lets the composer treat a null `video_model_used` as the tier the source's
 * own badge shows instead of an unreadable or not-yet-written one.
 * Also returns the remix-source brand signals: whether the source is the
 * requester's own project (owner or same org -- stricter than the view gate)
 * and, only when owned, the source's saved-brief id -- injected provenance
 * validated live, or (for provenance-less extraction sources) the org brief
 * the extracted brand was saved into -- so the composer's brand selector can
 * adopt or empty its pick.
 */
export async function getCarryUipContextFn(
  deps: CarryUipContextDeps,
  sourceProjectId: string,
  shareId?: string,
): Promise<{
  image_model_used: null | string
  remix_context: null | string
  source_brand_brief_id: null | string
  source_owned_by_requester: boolean
  video_model_known: boolean
  video_model_used: null | string
}> {
  if (!sourceProjectId) {
    throw new BadRequestException('source_project_id is required')
  }
  // View-access gate: owner/share OR any visitor of a public
  // long-take project. `shareId` lets the share page resolve a shared
  // (non-owned) source: the owner check fails there, but the gate passes when
  // the share link matches. Owner/project-page callers omit it. Structural-deps
  // cast, same idiom as long-take.service.ts's DebugDeps: the resolvers type
  // only the slice of the prisma client they touch.
  if (await deps.projectService.canViewProject(sourceProjectId, shareId)) {
    const [result, imageModelUsed, videoModel, ownedByRequester] = await Promise.all([
      summarizeRemixSource({ sourceProjectId }),
      resolveSourceImageModel(deps.prisma as never, sourceProjectId),
      resolveSourceVideoModel(deps.prisma as never, sourceProjectId),
      deps.projectService.isProjectOwnedByRequester(sourceProjectId),
    ])
    // Masked to owned sources: "not owned => null" holds across both branches,
    // and viewable strangers (public long-takes, share links) learn nothing
    // about a project's saved brand.
    let sourceBrandBriefId = ownedByRequester
      ? await resolveLiveBriefId(deps.prisma as never, result.sourceBrandBriefId)
      : null
    // Extraction-built sources carry no provenance (the brief is saved AFTER
    // extraction, at confirm), so fall back to the brief the brand was saved
    // into -- matched exactly the way the save deduped. Gated on the spec
    // having NO provenance at all: a recorded-but-invalid brief id (deleted /
    // foreign) must stay null, never re-adopt a same-name/domain row.
    if (ownedByRequester && sourceBrandBriefId === null && result.sourceBrandBriefId === null) {
      const orgId = getReqContext().org_id
      if (orgId && result.sourceBrandIdentity) {
        // Fail-open, matching createUipSession's catch on the same lookup: this
        // is best-effort enrichment, so a transient Prisma error resolves to no
        // derived brief instead of sinking the whole preview (remix context and
        // model selections the composer needs).
        const saved = await findBriefSavedFromSource(deps.prisma as never, {
          identity: result.sourceBrandIdentity,
          orgId,
        }).catch(() => null)
        sourceBrandBriefId = saved?.id ?? null
      }
    }
    return {
      image_model_used: imageModelUsed,
      remix_context: result.remixContext ?? null,
      source_brand_brief_id: sourceBrandBriefId,
      source_owned_by_requester: ownedByRequester,
      video_model_known: videoModel.known,
      video_model_used: videoModel.model,
    }
  }
  // Demo hop (resolvers return null for non-demo ids -- no disclosure). Both the
  // image and video models hop through the demo's sourceProjectId. Demos have
  // no Project row and no owner, so the brand signals are structurally
  // not-owned / no-brief here.
  const [imageModelUsed, videoModel] = await Promise.all([
    resolveDemoSourceImageModel(deps.prisma as never, sourceProjectId),
    resolveDemoSourceVideoModel(deps.prisma as never, sourceProjectId),
  ])
  return {
    image_model_used: imageModelUsed,
    remix_context: null,
    source_brand_brief_id: null,
    source_owned_by_requester: false,
    video_model_known: videoModel.known,
    video_model_used: videoModel.model,
  }
}
