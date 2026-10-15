/**
 * Endpoint resolution for the speech-side fal adapters (MiniMax speech and
 * voice clone, Kling lipsync). Their request building still lives with their
 * callers in libs/shared/common and moves here when those call sites migrate.
 */
import type { ResolvedModel } from '../registry/resolve'

import { endpointFor } from './types'

export const minimaxSpeechEndpoint = (model: ResolvedModel): string =>
  endpointFor(model, 'generate')
export const minimaxVoiceCloneEndpoint = (model: ResolvedModel): string =>
  endpointFor(model, 'generate')
export const klingLipsyncEndpoint = (model: ResolvedModel): string => endpointFor(model, 'generate')
