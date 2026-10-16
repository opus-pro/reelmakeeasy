'use client'

import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'

import { AgentVideoPlayer } from '../AgentVideoPlayer'

/** A rendered Motion Reel in the chat: the video, how its cuts sit on the beat, a download. */
export function MotionReelVideoCard({
  entry,
}: {
  entry: Extract<TranscriptEntry, { kind: 'motion_video' }>
}) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <AgentVideoPlayer
        aspectRatio="auto"
        poster={entry.posterUrl}
        src={entry.videoUrl}
        videoClassName="max-h-[60vh] w-auto"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
        {entry.report && <span>Beat check: {entry.report}</span>}
        <a className="text-primary underline underline-offset-2" download href={entry.videoUrl}>
          Download
        </a>
      </div>
    </div>
  )
}
