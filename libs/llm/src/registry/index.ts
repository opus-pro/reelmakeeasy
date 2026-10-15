/**
 * The model registry: which model serves each role, and how to call it.
 *
 * Node entry point (it loads `reelmakeeasy.models.json`). Browser code imports
 * the pure modules directly: `./schema`, `./resolve`, `./capabilities`.
 */
import { modelResolver } from './load'
import type { ModelResolver } from './resolve'

export * from './capabilities'
export * from './generation-provider'
export { type LegacyTarget, legacyTarget } from './legacy'
export {
  applyEnvOverrides,
  findModelsFile,
  type LoadedModelRegistry,
  loadModelRegistry,
  type LoadModelRegistryOptions,
  modelRegistry,
  modelRegistrySource,
  modelResolver,
  MODELS_FILE_NAME,
  resetModelRegistryForTesting,
  roleEnvVar,
} from './load'
export {
  createModelResolver,
  defaultRoleFor,
  isFalEndpointId,
  isGenerationProvider,
  type ModelResolver,
  onOtherProvider,
  type PublicModel,
  type PublicRegistry,
  type PublicRoleModel,
  type ResolutionSource,
  type ResolvedModel,
  type ResolvedModelWithSource,
  type ResolveOptions,
  type ResolverOptions,
  roleKeyFor,
  type VideoFrames,
  videoModeForFrames,
} from './resolve'
export * from './schema'

export const resolveRole: ModelResolver['resolveRole'] = (role) => modelResolver().resolveRole(role)
export const resolveModel: ModelResolver['resolveModel'] = (kind, requested, opts) =>
  modelResolver().resolveModel(kind, requested, opts)
export const resolveVideoForFrames: ModelResolver['resolveVideoForFrames'] = (
  requested,
  frames,
  opts,
) => modelResolver().resolveVideoForFrames(requested, frames, opts)
export const fallbacksFor: ModelResolver['fallbacksFor'] = (roleOrKey) =>
  modelResolver().fallbacksFor(roleOrKey)
export const capabilitiesFor: ModelResolver['capabilitiesFor'] = (kind, idOrKey) =>
  modelResolver().capabilitiesFor(kind, idOrKey)
export const isKnownModel: ModelResolver['isKnownModel'] = (kind, id) =>
  modelResolver().isKnownModel(kind, id)
export const publicRegistry: ModelResolver['publicRegistry'] = () =>
  modelResolver().publicRegistry()
