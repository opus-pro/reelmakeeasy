'use client'

import type { Transcript, TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'

import { AgentVideoPlayer } from '../AgentVideoPlayer'

import { MotionTasksPanel } from './MotionTasksPanel'

type MotionVideo = Extract<TranscriptEntry, { kind: 'motion_video' }>

/**
 * A Motion Reel chat's side panel: the agent's Tasks (what it is doing, the reel's phases, its
 * to-do list), then the latest render, large, with its beat check. Before the first render,
 * what the chat is set up to make.
 */
export function MotionReelPanel({ transcript }: { transcript: Transcript }) {
  const videos = transcript.entries.filter((e): e is MotionVideo => e.kind === 'motion_video')
  const latest = videos.at(-1)
  const setup = transcript.entries.findLast(
    (e) => e.kind === 'motion_setup' && e.state === 'chosen',
  )
  return (
    <div className="flex size-full flex-col gap-3 overflow-y-auto p-4">
      <MotionTasksPanel transcript={transcript} />
      <div className="border-t border-white/10" />
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
            ? `Your ${setup.setup.styleLabel} reel will play here once it's rendered.`
            : 'Set up your Motion Reel in the chat; it will play here once it is rendered.'}
        </div>
      )}
    </div>
  )
}
