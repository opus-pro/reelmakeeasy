/**
 * The single source of truth for per-model video capability limits.
 *
 * Every output duration set, reference-video input ceiling, max output
 * resolution, and accepted aspect-ratio list lives in exactly one row here.
 * Feature modules import from this barrel; they never redeclare a literal. See
 * docs/constraints/dont-scatter-model-capability-constants.md.
 *
 * Values and pure helpers only -- no provider dispatch logic. `veo3/gen-video.ts`
 * keeps the runtime dispatch so web bundles and jest specs can read capabilities
 * without pulling in the provider clients (libs/llm).
 */
export * from './bria'
export * from './bytedance'
export * from './capabilities'
export * from './fal'
export * from './gemini-omni'
export * from './happyhorse'
export * from './inpaint'
export * from './kling'
export * from './minimax'
export * from './types'
export * from './veo'
export * from './vidu'
