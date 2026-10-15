'use client'

import {
  REELMAKEEASY_MESSAGE_PREFIX,
  type TranscriptEntry,
  VIDEO_STARTED_MESSAGE,
} from '@reelmakeeasy/common/codex-agent/agent-transcript'

import { AgentMarkdown } from './AgentMarkdown'
import { useProjectProgress } from './useProjectProgress'

/** What replaces "Your video is being made" once that video's run failed: the video card
 *  right above it says why, and in a chat the agent then offers a fix. */
export const VIDEO_FAILED_LINE = "Your video couldn't be made."

/** What replaces it once the video is done: the card right above it plays it. A story video
 *  and a loop short say the same. */
export const VIDEO_READY_LINE = 'Your video is ready.'

/** A clip as the chat names it: its number in the loop (a storyboard id `s3` is clip 3), else
 *  its id as it is. */
function clipName(clipId: string): string {
  return /^s(\d+)$/i.exec(clipId)?.[1] ?? clipId
}

/** "1", "1 and 2", "1, 2 and 5". */
function listed(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What replaces it once a loop is done with clips its checks still flag (`flaggedClips`):
 *  which ones, and that they can be made again. */
export function videoFlaggedLine(clipIds: readonly string[]): string {
  const one = clipIds.length === 1
  const clips = `${one ? 'clip' : 'clips'} ${listed(clipIds.map(clipName))}`
  return `Your video is ready, but ${clips} didn't pass every check. You can ask to make ${one ? 'it' : 'them'} again.`
}

/** ReelMakeEasy's "Your video is being made" messages, by entry id, each to the video it follows. */
export function videoStartedLines(entries: readonly TranscriptEntry[]): Map<string, string> {
  const lines = new Map<string, string>()
  let projectId: null | string = null
  for (const entry of entries) {
    if (entry.kind === 'video') projectId = entry.projectId
    else if (
      projectId &&
      entry.kind === 'assistant' &&
      entry.id.startsWith(REELMAKEEASY_MESSAGE_PREFIX) &&
      entry.text === VIDEO_STARTED_MESSAGE
    )
      lines.set(entry.id, projectId)
  }
  return lines
}

/**
 * ReelMakeEasy's "Your video is being made" message, following that video (the shared project
 * poll), so the chat never says a finished or failed video is still being made: while it is
 * made, the message as posted; once done (a story video or a loop short alike), that it is
 * ready, or for a loop whose checks still flag clips, which ones; once its run failed, the
 * failure in its place.
 */
export function VideoStartedLine({ projectId, text }: { projectId: string; text: string }) {
  const { done, error, flaggedClips } = useProjectProgress(projectId)
  if (done && flaggedClips.length) {
    return <p className="max-w-[80%] text-sm text-amber-400">{videoFlaggedLine(flaggedClips)}</p>
  }
  if (done) return <AgentMarkdown className="max-w-[80%]" text={VIDEO_READY_LINE} />
  if (error) return <p className="max-w-[80%] text-sm text-red-400">{VIDEO_FAILED_LINE}</p>
  return <AgentMarkdown className="max-w-[80%]" text={text} />
}
