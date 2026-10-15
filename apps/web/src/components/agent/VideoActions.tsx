'use client'

import { Switch } from '@shared/ui'
import { useId } from 'react'

import { LongTakeExportProgressDialog } from '@/app/story-mode/components/LongTakeViewer/LongTakeDownload'
import {
  musicRequestFromProject,
  useLiveMusicVolume,
  useMusicToggle,
} from '@/app/story-mode/hook/useMusicToggle'
import { CaptionStyleButton } from '@/components/captions/CaptionStyleButton'
import {
  useCaptionStatus,
  useDeliveredCaptionLookDiffers,
} from '@/components/captions/useCaptionSettings'
import { Download } from '@/components/icons/core'
import { MusicChangeButton } from '@/components/music/MusicChangeButton'
import { MusicVolumeSlider } from '@/components/music/MusicVolumeSlider'

import { Spinner } from './Spinner'
import { useProjectAspectRatio } from './useAgentProject'
import { useAgentVideoDownload } from './useAgentVideoDownload'
import type { ProjectProgress } from './useProjectProgress'

export type VideoActionsProps = {
  /** The player above is the editor engine, which already shows the switch's choice. */
  livePreview: boolean
  progress: ProjectProgress
  projectId: string
}

/** The link to the project in the Story Mode editor. Without the composer's `firstView=1`,
 *  whose only effect there is that Close goes to /projects: from here, Close should come
 *  back to this chat. A full page load, not a client-side navigation: the editor runs its
 *  own engine, and this page's preview engines should go with this page rather than
 *  stay behind in the editor's document. */
export function OpenInEditorLink({ projectId }: { projectId: string }) {
  return (
    <a
      className="w-fit text-sm text-primary underline underline-offset-2 hover:text-secondary"
      href={`/story-mode/${encodeURIComponent(projectId)}`}
    >
      Open in editor
    </a>
  )
}

/**
 * What Download will change in the file a file player shows, if anything: the captions
 * switch's change first, else the caption look (a loop's stamp colour, with captions off).
 */
function downloadCaptionsLine({
  captionsInVideo,
  captionsOn,
  lookDiffers,
}: {
  captionsInVideo: boolean | null
  captionsOn: boolean | null
  lookDiffers: boolean
}): null | string {
  if (captionsOn === null || captionsInVideo === null) return null
  if (captionsOn !== captionsInVideo) {
    return captionsOn
      ? 'This video has no captions yet: Download adds them.'
      : 'This video has captions: Download removes them.'
  }
  if (!lookDiffers) return null
  return captionsOn
    ? "This video's captions are in another style: Download renders it again."
    : "This video's fact stamps are in another colour: Download renders it again."
}

/**
 * What a finished agent video offers under its player, like the editor: one "Captions"
 * switch with its Style, Download and the link to the editor.
 *
 * `livePreview`: the player above is the editor engine, not the file.
 */
export function VideoActions({ livePreview, progress, projectId }: VideoActionsProps) {
  const switchId = useId()
  const musicSwitchId = useId()
  const { busy, captionsOn, download, handleDownload, locked, project, setCaptionsOn } =
    useAgentVideoDownload({ progress, projectId })
  const { isExportDisabled } = download
  const { captionsInVideo, videoUrl } = progress
  // Music changes rewrite the delivered file in place (no Download render needed).
  const music = useMusicToggle(projectId, {
    bgmEnabled: progress.bgmEnabled,
    bgmVolume: progress.bgmVolume,
    // A file player (no live preview) has to reload to play a new level.
    reloadPlayersOnVolume: !livePreview,
    delivered: progress.delivered,
    hasBed: !!progress.bgmBedUrl,
  })
  // The level the previews play: what the slider is on, ahead of the saved one.
  const liveMusicVolume = useLiveMusicVolume(projectId, progress.bgmVolume)
  // A loop's highlight still colours its fact stamps with captions off.
  const isLoop = useCaptionStatus(projectId).status?.kind === 'loop'
  // The file's look against the one chosen (or the default, for a loop delivered before looks
  // were recorded): a file player shows the file, so say Download renders it again.
  const lookDiffers = useDeliveredCaptionLookDiffers(
    projectId,
    useProjectAspectRatio(projectId),
    captionsOn ?? captionsInVideo ?? true,
  )
  const captionsLine = livePreview
    ? null
    : downloadCaptionsLine({ captionsInVideo, captionsOn, lookDiffers })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {captionsOn !== null && (
          <div className="flex items-center gap-2">
            <Switch
              checked={captionsOn}
              className="data-[state=unchecked]:bg-white/25"
              // Its value is what an export in flight is rendering; a music rewrite is
              // writing the same file.
              disabled={busy || music.busy}
              id={switchId}
              onCheckedChange={setCaptionsOn}
            />
            <label className="text-sm text-primary" htmlFor={switchId}>
              Captions
            </label>
            {(captionsOn || isLoop) && (
              <CaptionStyleButton
                captionsOn={captionsOn}
                disabled={busy || music.busy}
                livePreview={livePreview}
                projectId={projectId}
              />
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Switch
            checked={music.musicOn}
            className="data-[state=unchecked]:bg-white/25"
            disabled={busy || music.busy || !progress.delivered}
            id={musicSwitchId}
            onCheckedChange={(next) => void music.setMusicOn(next)}
          />
          <label className="text-sm text-primary" htmlFor={musicSwitchId}>
            Music
          </label>
          {music.musicOn && progress.bgmTrackName && (
            <span className="max-w-40 truncate text-sm text-secondary">
              {progress.bgmTrackName}
            </span>
          )}
          {music.busy ? (
            // A change is running: say what it is, not just lock the controls.
            <span
              className="flex min-w-0 max-w-full items-center gap-1.5 text-sm text-secondary"
              role="status"
            >
              <Spinner />
              <span className="truncate">{music.busyLabel ?? 'Updating the music…'}</span>
            </span>
          ) : (
            <MusicChangeButton
              current={musicRequestFromProject(progress)}
              disabled={busy || !progress.delivered}
              onPick={(request) => void music.applyRequest(request)}
            />
          )}
        </div>
        <button
          className="flex w-fit items-center gap-1 text-sm text-primary hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50"
          // Another video's Download is preparing: one at a time. A music rewrite is
          // replacing the file, so a download mid-copy would be cut short.
          disabled={busy || music.busy || isExportDisabled || locked}
          onClick={() => void handleDownload()}
          type="button"
        >
          {busy ? <Spinner /> : <Download aria-hidden className="size-4" />}
          Download
        </button>
        <OpenInEditorLink projectId={projectId} />
      </div>
      {captionsLine && <p className="text-xs text-secondary">{captionsLine}</p>}
      {music.musicOn && progress.delivered && (
        <MusicVolumeSlider
          disabled={busy || music.volumeLocked}
          onChange={music.previewVolume}
          onCommit={(volume) => void music.setVolume(volume)}
          volume={liveMusicVolume}
        />
      )}
      <LongTakeExportProgressDialog
        download={download}
        thumbnailUrl={project?.resultVideoThumbnail}
        videoUrl={videoUrl ?? undefined}
      />
    </div>
  )
}
