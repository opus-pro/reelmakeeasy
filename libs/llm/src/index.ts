import { completion, completionWithMeta } from './chat'
import { configureLLM, type LLMLogger } from './config'
import { generateAudio, generateImageWithMeta, generateVideo } from './media'

export {
  type ChatEndpointPreference,
  configureLLM,
  type LLMConfig,
  type LLMLogger,
  setChatEndpointPreference,
} from './config'
export { resolveChatModels, setChatTransportResolver } from './chat'
export { toDataUri } from './content'
export { fal, type FalClient, runFal } from './fal'
export {
  describeGoogleFailure,
  type GenerateContentResponse,
  GOOGLE_SAFETY_MESSAGE,
  GoogleApiError,
  type GoogleFile,
  googleHttpError,
  type GoogleInlineData,
  type GoogleInteraction,
  type GoogleInteractionContent,
  type GoogleOperation,
  type GooglePart,
  type GoogleProviderCode,
  type GoogleWordInfo,
  inlineDataFromUri,
  inlineParts,
  interactionContent,
  modelOutput,
  runGoogle,
  safetyError,
} from './google'
export {
  audioLlmRoute,
  currentLlmProvider,
  LLM_NOT_SET_UP_MESSAGE,
  llmCanHearAudio,
  LlmNotSetUpError,
  type LlmProviderName,
  setCurrentLlmProvider,
} from './llm-provider'
export * from './types'
export * from './registry'

/**
 * Model access for ReelMakeEasy.
 *
 * Text goes to any OpenAI-compatible chat endpoint. Images, video and music go
 * to the generation provider chosen in Setup: fal's queue API (runFal), or
 * Google's Gemini API (runGoogle, GEMINI_API_KEY). There is no provider SDK in
 * between: all of it is plain HTTP.
 */
export const LLM = {
  completion,
  completionWithMeta,
  generateAudio,
  generateImageWithMeta,
  generateVideo,
  init(options: { logger?: LLMLogger; resolveUri?: (uri: string) => Promise<string> }): void {
    configureLLM({
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.resolveUri ? { resolveUri: options.resolveUri } : {}),
    })
  },
}
