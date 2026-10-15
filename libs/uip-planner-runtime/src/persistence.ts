import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'

import { AssetDescriptionsArtifact, Spec } from './types'

export function createPlannerStorage(sessionId: string): ProjectStore {
  // Storage root: projects/<projectId>/user-intent-planner/
  // All UIP artifacts (spec, anchor_assets, assets) live under the project root.
  return new ProjectStore(`${sessionId}/user-intent-planner`)
}

export async function loadAssetDescriptions(
  sessionId: string,
): Promise<AssetDescriptionsArtifact | null> {
  if (process.env['NODE_ENV'] === 'test') {
    return null
  }

  const storage = createPlannerStorage(sessionId)
  const relativePath = 'assets/image_description.json'
  const exists = await storage.exists(relativePath)
  if (!exists) {
    return null
  }

  return storage.readJsonFile<AssetDescriptionsArtifact>(relativePath)
}

export async function loadPlannerJsonArtifact<T>(
  sessionId: string,
  relativePath: string,
): Promise<null | T> {
  if (process.env['NODE_ENV'] === 'test') {
    return null
  }

  const storage = createPlannerStorage(sessionId)
  const exists = await storage.exists(relativePath)
  if (!exists) {
    return null
  }

  return storage.readJsonFile<T>(relativePath)
}

// Read an artifact from the PROJECT root (projects/<projectId>/...) rather than the planner's
// user-intent-planner/ subtree. Used for cross-pipeline artifacts the story-mode runtime
// writes pre-confirm (e.g. the music beat sheet at long_take/experts/beat_sheet.json).
export async function loadProjectJsonArtifact<T>(
  sessionId: string,
  relativePath: string,
): Promise<null | T> {
  if (process.env['NODE_ENV'] === 'test') {
    return null
  }

  const storage = new ProjectStore(sessionId)
  const exists = await storage.exists(relativePath)
  if (!exists) {
    return null
  }

  return storage.readJsonFile<T>(relativePath)
}

export async function persistAssetDescriptions(
  sessionId: string,
  assetDescriptions: AssetDescriptionsArtifact,
): Promise<void> {
  if (process.env['NODE_ENV'] === 'test') {
    return
  }

  const storage = createPlannerStorage(sessionId)
  await storage.writeJsonFile('assets/image_description.json', assetDescriptions)
}

export async function persistPlannerJsonArtifact<T>(
  sessionId: string,
  relativePath: string,
  payload: T,
): Promise<void> {
  if (process.env['NODE_ENV'] === 'test') {
    return
  }

  const storage = createPlannerStorage(sessionId)
  await storage.writeJsonFile(relativePath, payload)
}

export async function persistSpecSnapshot(sessionId: string, spec: Spec): Promise<void> {
  if (process.env['NODE_ENV'] === 'test') {
    return
  }

  const storage = createPlannerStorage(sessionId)
  const versionDir = `spec/versions/v${spec.meta.spec_version}`

  await Promise.all([
    storage.writeJsonFile('spec/current/spec.json', spec),
    storage.writeJsonFile('spec/current/global_constraints.json', spec.global_constraints),
    storage.writeJsonFile('spec/current/visual_script.json', spec.visual_script),
    storage.writeJsonFile('spec/current/meta.json', spec.meta),
    storage.writeJsonFile(`${versionDir}/spec.json`, spec),
    storage.writeJsonFile(`${versionDir}/global_constraints.json`, spec.global_constraints),
    storage.writeJsonFile(`${versionDir}/visual_script.json`, spec.visual_script),
    storage.writeJsonFile(`${versionDir}/meta.json`, spec.meta),
  ])
}
