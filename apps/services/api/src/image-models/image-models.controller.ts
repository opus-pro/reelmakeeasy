import { getDefaultImageModelId } from '@reelmakeeasy/common/llm/image-model-selection'
import { logger } from '@reelmakeeasy/common/logger'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { Controller, Get, Query } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { resolveUserDefaultImageModel } from '../uip/user-default-image-model.util'

@Controller('image-models')
export class ImageModelsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The current user's carried-forward default image model (Cost Phase 2):
   * the model their FIRST PT-routed project actually rendered on
   * (Project.routedImageModel), else the org config default.
   *
   * The dashboard omnibox has no project/session yet, so it cannot read the
   * per-session `getSession.carried_forward_image_model` the planner uses. This
   * user-level endpoint gives the omnibox the same value so a do-nothing user
   * sees the model their prior project used. The FE seeds the selector
   * DISPLAY only (it must NOT write the explicit-pick atom, or the project would
   * count as an explicit pick and lose PT-routing eligibility).
   *
   * Owner is `login_id` (not `user_id`) to match the eligibility / carried-
   * forward scope used by the freeze + startWorkflow paths.
   *
   * Exposed as the `q=default` read-variant on the collection
   * (`GET /image-models?q=default`) rather than a bespoke `/default` subpath, per
   * the house REST standard (read variants use `q=`, not new paths). Any other
   * or absent `q` returns the org config default, so the endpoint always yields
   * a usable image model.
   */
  @Get()
  async getImageModels(@Query('q') q?: string): Promise<{ imageModel: string }> {
    const reqCtx = getReqContext()
    const orgId = reqCtx.org_id || null
    if (q !== 'default') {
      return { imageModel: getDefaultImageModelId() }
    }
    try {
      const imageModel = await resolveUserDefaultImageModel(
        this.prisma as never,
        reqCtx.login_id || '',
        orgId,
      )
      return { imageModel }
    } catch (error) {
      // Fail open to the org config default: a dashboard default lookup must
      // never break the create surface.
      logger.warn('[image-models?q=default] carried-forward lookup failed', { error })
      return { imageModel: getDefaultImageModelId() }
    }
  }
}
