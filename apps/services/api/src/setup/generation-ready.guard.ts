import { generationNotReadyMessage, generationProviderReady } from '@reelmakeeasy/llm/registry'
import { type CanActivate, ConflictException, Injectable } from '@nestjs/common'

/**
 * Refuses a route (409) while neither fal nor Gemini can make a video, in the words
 * `LongTakeService.startWorkflow` uses (phase 3's `generationNotReadyMessage()`, with the
 * reason). On the UIP session start, which the current composer doesn't call.
 */
@Injectable()
export class GenerationReadyGuard implements CanActivate {
  canActivate(): boolean {
    if (!generationProviderReady()) throw new ConflictException(generationNotReadyMessage())
    return true
  }
}
