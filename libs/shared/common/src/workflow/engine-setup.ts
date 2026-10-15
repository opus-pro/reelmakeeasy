import {
  currentGenerationProvider,
  type GenerationProvider,
  setGenerationProviderPin,
} from '@reelmakeeasy/llm/registry'
import { configureEngine, type ContextPropagator } from '@reelmakeeasy/workflow-engine/worker'
import type { ReqContext } from '@shared/types/api/req-ctx'

import { logger } from '../logger'
import { getReqContext, hasContext, runWithContext } from '../utils/req-ctx'

import { pinnedGenerationProvider, runWithGenerationPin } from './generation-pin'

/** What a run carries from its start: the request identity, and the generation provider. */
interface RunContext {
  generationProvider: GenerationProvider
  req?: ReqContext
}

let configured = false

/**
 * Captures the caller's request context and the generation provider chosen in Setup when a run
 * starts, and restores both around the run's code: a run keeps its provider through a switch.
 */
export const runContextPropagator: ContextPropagator = {
  capture: (): RunContext => ({
    generationProvider: currentGenerationProvider(),
    ...(hasContext() ? { req: { ...getReqContext() } } : {}),
  }),
  run: (ctx, fn) => {
    const { generationProvider, req } = ctx as RunContext
    const pinned = () => runWithGenerationPin(generationProvider, fn)
    return req ? runWithContext(req, pinned) : pinned()
  },
}

/** Wires the workflow engine to the app logger, request context and the run's provider. */
export function setupWorkflowEngine(): void {
  if (configured) return
  configured = true
  setGenerationProviderPin(pinnedGenerationProvider)
  configureEngine({
    logger: {
      debug: (msg, meta) => logger.debug(meta ?? {}, msg),
      error: (msg, meta) => logger.error(meta ?? {}, msg),
      info: (msg, meta) => logger.info(meta ?? {}, msg),
      trace: (msg, meta) => logger.trace(meta ?? {}, msg),
      warn: (msg, meta) => logger.warn(meta ?? {}, msg),
    },
    propagator: runContextPropagator,
  })
}
