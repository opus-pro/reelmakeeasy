'use client'

import { AgentVideoPreview } from './AgentVideoPreview'
import { EditCard } from './EditCard'
import { Spinner } from './Spinner'
import { useProjectProgress } from './useProjectProgress'
import { OpenInEditorLink } from './VideoActions'

export type VideoProgressCardProps = {
  /** The chat is already editing this video: no Edit card. */
  editing?: boolean
  /** Opens the chat for editing the finished video (shows the Edit card once done). */
  onEdit?: () => Promise<boolean>
  projectId: string
}

const CARD_CLASS =
  'flex w-full max-w-xl flex-col gap-2 rounded-xl border border-white/10 bg-fill-secondary/50 p-3'

/** "1 shot ready", "4 shots ready". */
export const shotsReady = (count: number) => `${count} shot${count === 1 ? '' : 's'} ready`

/** A thin bar at `percent` (0-100). */
export function ProgressBar({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value}
      className="h-1 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-accent-green transition-[width] duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

/**
 * The video an autonomous session started, followed live (the shared project poll): the
 * stage headline and a progress bar while it renders, the finished video inline once done
 * (played by the editor's engine like the storyboard's, with the caption switch and
 * Download: `AgentVideoPreview`), or what went wrong. Every state links to the
 * project in the editor, so a render that never finishes (an API restart ends it) still has
 * a way out.
 */
export function VideoProgressCard({ editing, onEdit, projectId }: VideoProgressCardProps) {
  const progress = useProjectProgress(projectId)
  const { done, error, headline, keyframes, percent, videoUrl } = progress

  if (done && videoUrl) {
    return (
      <div className={CARD_CLASS}>
        <AgentVideoPreview
          progress={progress}
          projectId={projectId}
          // At most 480px, and 60% of a phone screen.
          videoClassName="h-[min(480px,60svh)]"
          videoUrl={videoUrl}
        />
        {onEdit && !editing && <EditCard onEdit={onEdit} />}
      </div>
    )
  }

  if (error) {
    return (
      <div className={CARD_CLASS}>
        <p className="text-sm text-red-400">Video generation failed: {error}</p>
        <OpenInEditorLink projectId={projectId} />
      </div>
    )
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Spinner className="text-secondary" />
        <span>Making your video</span>
      </div>
      <p className="text-xs text-secondary">
        {headline}
        {keyframes.length > 0 && ` · ${shotsReady(keyframes.length)}`}
      </p>
      <ProgressBar percent={percent} />
      {/* A way out if the render never finishes (e.g. an API restart killed it). */}
      <OpenInEditorLink projectId={projectId} />
    </div>
  )
}
