import { ArtifactKey } from '../tool-manifest'
import { SessionState } from '../types'

export function getMissingArtifactDependencies(
  session: SessionState,
  requires: ArtifactKey[],
): ArtifactKey[] {
  return requires.filter((artifactKey) => !hasArtifact(session, artifactKey))
}

function hasArtifact(session: SessionState, artifactKey: ArtifactKey): boolean {
  switch (artifactKey) {
    case 'anchor_assets': {
      const s = session.cached_artifacts.anchor_assets_summary?.status
      return s === 'success' || s === 'partial'
    }
    case 'asset_assignment_plan': {
      return Boolean(session.cached_artifacts.pending_asset_assignment_plan?.actions?.length)
    }
    case 'asset_descriptions': {
      return Boolean(session._loaded_asset_descriptions?.items?.length)
    }
    case 'brand_bank': {
      return Boolean(session.spec.global_constraints.brand_bank)
    }
    case 'global_constraints': {
      const gc = session.spec.global_constraints
      return (
        Boolean(session.cached_artifacts.pending_global_constraints) ||
        Boolean(gc.topic?.trim()) ||
        Boolean(gc.video_type?.trim()) ||
        Boolean(gc.target_audience?.trim())
      )
    }
    case 'script': {
      return (
        session.spec.visual_script.shots.some((shot) => Boolean(shot.audio_vo?.trim())) ||
        Boolean(session.cached_artifacts.working_script?.script?.trim())
      )
    }
    case 'uploaded_assets': {
      return Boolean(session.cached_artifacts.uploaded_assets?.length)
    }
    case 'visual_script': {
      return (
        Boolean(session.cached_artifacts.pending_visual_script_shots?.length) ||
        Boolean(session.spec.visual_script.shots.length)
      )
    }
    default: {
      return false
    }
  }
}
