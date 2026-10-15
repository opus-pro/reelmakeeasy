import { NotFoundException } from '@nestjs/common'

import { computeChangedShotFields, renderPlanMd } from './uip-planner-utils'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

export async function getSpecVersionFromStorage(params: { projectId: string; version: number }) {
  const { projectId, version } = params
  const basePath = `projects/${projectId}/user-intent-planner/spec/versions`

  const file = fileStore.file(`${basePath}/v${version}/spec.json`)
  const exists = await file.exists()
  if (!exists) {
    throw new NotFoundException(`Spec version ${version} not found`)
  }
  const spec = JSON.parse((await file.read()).toString())

  let planMd = renderPlanMd(spec)
  if (version > 0) {
    const prevFile = fileStore.file(`${basePath}/v${version - 1}/spec.json`)
    const prevExists = await prevFile.exists()
    if (prevExists) {
      const prevSpec = JSON.parse((await prevFile.read()).toString())
      const changedShots = computeChangedShotFields(prevSpec, spec)
      planMd = renderPlanMd(spec, { changedShots })
    }
  }

  let anchorAssets = null
  try {
    const anchorFile = fileStore.file(`${basePath}/v${version}/anchor_assets.json`)
    const anchorExists = await anchorFile.exists()
    if (anchorExists) {
      anchorAssets = JSON.parse((await anchorFile.read()).toString())
    }
  } catch {
    // Non-fatal: anchor snapshot may not exist for early versions.
  }

  return { anchor_assets: anchorAssets, plan_md: planMd, spec, version }
}
