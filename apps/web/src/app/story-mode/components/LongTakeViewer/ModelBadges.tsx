import { useResolvedVideoModel } from '@/hooks/useModels'

const BADGE_CLASS =
  'flex h-[30px] shrink-0 cursor-default items-center gap-1 rounded-[10px] bg-white/10 px-2 text-sm font-medium text-primary'

export interface ModelBadgesProps {
  // Transition video model id; null = the default model, undefined = no badge.
  videoModel?: null | string
}

/**
 * Read-only badge for a project's info-pills row: the model label from
 * `GET /api/models`, resolved the way the server resolves the id, so a legacy
 * id reads as the model it now runs on.
 */
export function ModelBadges({ videoModel }: ModelBadgesProps) {
  if (videoModel === undefined) {
    return null
  }
  return <VideoModelBadge videoModel={videoModel} />
}

function VideoModelBadge({ videoModel }: { videoModel: null | string }) {
  const model = useResolvedVideoModel(videoModel)
  if (!model) {
    return null
  }
  return <span className={BADGE_CLASS}>{model.label}</span>
}
