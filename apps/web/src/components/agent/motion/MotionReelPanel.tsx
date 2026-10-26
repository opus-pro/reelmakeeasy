'use client'

import type { Transcript, TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'

import { AgentVideoPlayer } from '../AgentVideoPlayer'

import { MotionTasksPanel } from './MotionTasksPanel'

type MotionVideo = Extract<TranscriptEntry, { kind: 'motion_video' }>

/**
 * A Motion Reel or Claude Animation chat's side panel: a Motion Reel's Tasks (what the agent is
 * doing, the reel's phases, its to-do list), then the latest render, large, with its beat check
 * (a Motion Reel's). Before the first render, what the chat is set up to make.
 */
export function MotionReelPanel({ transcript }: { transcript: Transcript }) {
  const videos = transcript.entries.filter((e): e is MotionVideo => e.kind === 'motion_video')
  const latest = videos.at(-1)
  const setup = transcript.entries.findLast(
    (e) => (e.kind === 'motion_setup' || e.kind === 'animation_setup') && e.state === 'chosen',
  )
  const animation = transcript.entries.some((e) => e.kind === 'animation_setup')
  return (
    <div className="flex size-full flex-col gap-3 overflow-y-auto p-4">
      {!animation && (
        <>
          <MotionTasksPanel transcript={transcript} />
          <div className="border-t border-white/10" />
        </>
      )}
      {latest ? (
        <>
          <div className="flex items-center justify-between text-xs text-secondary">
            <span>Latest render{videos.length > 1 ? ` · version ${videos.length}` : ''}</span>
            <a
              className="text-primary underline underline-offset-2"
              download
              href={latest.videoUrl}
            >
              Download
            </a>
          </div>
          <AgentVideoPlayer
            aspectRatio="auto"
            key={latest.id}
            poster={latest.posterUrl}
            src={latest.videoUrl}
            videoClassName="max-h-[70vh] w-full"
          />
          {latest.report && <p className="text-xs text-secondary">Beat check: {latest.report}</p>}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-secondary">
          {setup?.kind === 'motion_setup' && setup.setup
            ? `${setup.setup.typeLabel}: your reel will play here once it's rendered.`
            : setup?.kind === 'animation_setup' && setup.setup
              ? `Your ${setup.setup.lookLabel} animation will play here once it's rendered.`
              : animation
                ? 'Set up your animation in the chat; it will play here once it is rendered.'
                : 'Set up your Motion Reel in the chat; it will play here once it is rendered.'}
        </div>
      )}
    </div>
  )
}
