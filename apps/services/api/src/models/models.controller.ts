import { publicRegistry } from '@reelmakeeasy/llm/registry'
import { Controller, Get } from '@nestjs/common'
import type { ModelsResponse } from '@shared/types/api/models'

@Controller('models')
export class ModelsController {
  /**
   * The model each role resolves to, plus every registry entry's label and
   * capabilities, for the web's model labels and badges. Read-only and
   * user-independent: the registry is process-wide config. `publicRegistry()`
   * already omits endpoints, adapters and provider model ids.
   */
  @Get()
  getModels(): ModelsResponse {
    return publicRegistry()
  }
}
