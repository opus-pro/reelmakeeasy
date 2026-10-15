'use client'

import {
  loopScriptLines,
  pickedCameraStyle,
  pickedIdea,
  pickedMusic,
  pickedOpening,
  scriptLines,
} from '@reelmakeeasy/common/codex-agent/agent-storyboard'
import type { Transcript, TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type { AgentMode } from '@shared/types/api/agent'
import type { LongTakeStatusStage } from '@shared/types/api/long-take'
import { type ReactNode, useMemo } from 'react'

import { STAGES } from '@/app/story-mode/components/LongTakeViewer/progress'

import { AgentVideoPreview } from './AgentVideoPreview'
import { useAgentImageSrc } from './useAgentImageSrc'
import { type ProjectProgress, useProjectProgress } from './useProjectProgress'
import { OpenInEditorLink } from './VideoActions'
import { ProgressBar, shotsReady } from './VideoProgressCard'

export type StoryboardPanelProps = {
  /** The session's mode (the transcript's, else the session record's); null until chosen. */
  mode: AgentMode | null
  sessionId: string
  transcript: Transcript
}

type ImageDoneEntry = Extract<TranscriptEntry, { kind: 'image' }> & { status: 'done' }
type StyleEntry = Extract<TranscriptEntry, { kind: 'style' }>

const KEYFRAMES_INDEX = STAGES.findIndex((s) => s.id === 'keyframes')

/** The render hasn't finished its keyframes yet (it may still be queued or starting). */
const keyframesPending = (stage: LongTakeStatusStage | null) => {
  if (!stage || stage === 'queued') return true
  const index = STAGES.findIndex((s) => s.id === stage)
  return index !== -1 && index <= KEYFRAMES_INDEX
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-secondary uppercase">{title}</h3>
      {children}
    </section>
  )
}

function ShotsGrid({ progress }: { progress: ProjectProgress }) {
  const pending = !progress.error && !progress.done && keyframesPending(progress.stage)
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {progress.keyframes.map((keyframe, i) => (
        <div
          className="relative aspect-[9/16] overflow-hidden rounded-md bg-fill-secondary"
          key={keyframe.shotId}
        >
          <img alt={`Shot ${i + 1}`} className="size-full object-cover" src={keyframe.url} />
          <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {i + 1}
          </span>
        </div>
      ))}
      {pending && (
        <div
          aria-label="More shots coming"
          className="aspect-[9/16] animate-pulse rounded-md bg-white/10"
          role="img"
        />
      )}
    </div>
  )
}

function StoryboardImage({ entry, sessionId }: { entry: ImageDoneEntry; sessionId: string }) {
  const src = useAgentImageSrc(sessionId, entry.src)
  if (!src) return null
  return <img alt="" className="w-full rounded-lg object-cover" src={src} />
}

/**
 * The right-hand panel of the agent page: the plan and the video building up as the
 * session goes. Sections show only once they have something: the finished video (played by
 * the editor's engine, like the editor previews it: `AgentVideoPreview`), the
 * render's progress, the picked idea, the brief, the style, the script, the shots
 * (autonomous mode), and Codex's images (free chat). Progress comes from the
 * same shared poll as the chat's video card. A loop short's brief (`make_beat_loop`) brings
 * its lines: the script shows them, each with its fact stamp, from before the video starts.
 */
export function StoryboardPanel({ mode, sessionId, transcript }: StoryboardPanelProps) {
  const { entries } = transcript
  const projectId = useMemo(
    () =>
      entries.findLast((e): e is Extract<TranscriptEntry, { kind: 'video' }> => e.kind === 'video')
        ?.projectId ?? null,
    [entries],
  )
  const progress = useProjectProgress(projectId)
  const autonomous = mode === 'autonomous'

  const idea = useMemo(() => (autonomous ? pickedIdea(entries) : null), [autonomous, entries])
  const opening = useMemo(() => (autonomous ? pickedOpening(entries) : null), [autonomous, entries])
  const camera = useMemo(
    () => (autonomous ? pickedCameraStyle(entries) : null),
    [autonomous, entries],
  )
  const music = useMemo(() => (autonomous ? pickedMusic(entries) : null), [autonomous, entries])
  const style = useMemo(
    () => entries.findLast((e): e is StyleEntry => e.kind === 'style' && e.state === 'chosen'),
    [entries],
  )
  const images = useMemo(
    () =>
      autonomous || mode === null
        ? []
        : entries.filter(
            (e): e is ImageDoneEntry => e.kind === 'image' && e.status === 'done' && !!e.src,
          ),
    [autonomous, entries, mode],
  )
  const brief = transcript.brief
  const lines = useMemo(
    () => (progress.script ? scriptLines(progress.script) : []),
    [progress.script],
  )
  const loopLines = useMemo(
    () => (brief?.lines?.length ? loopScriptLines(brief.lines, progress.script) : null),
    [brief, progress.script],
  )

  const showVideo = !!projectId && progress.done && !!progress.videoUrl
  const showProgress = !!projectId && !progress.done
  const showShots =
    !!projectId &&
    (progress.keyframes.length > 0 ||
      (!progress.error && !progress.done && keyframesPending(progress.stage)))

  const empty =
    !showVideo &&
    !showProgress &&
    !idea &&
    !brief &&
    !camera &&
    !style &&
    lines.length === 0 &&
    !showShots &&
    images.length === 0

  return (
    <section aria-label="Storyboard" className="flex h-full flex-col bg-background text-primary">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        {empty && (
          <p className="text-sm text-secondary">
            Your plan and storyboard will build up here as you go.
          </p>
        )}

        {showVideo && progress.videoUrl && projectId && (
          <Section title="Video">
            <AgentVideoPreview
              // A new project gets a fresh player (and engine).
              key={projectId}
              progress={progress}
              projectId={projectId}
              // The controls stay in view without scrolling the pane: below md the pane is
              // half the screen (stacked under the chat).
              videoClassName="h-[min(70vh,calc(50svh_-_8rem))] md:h-[min(70vh,calc(100svh_-_12rem))]"
              videoUrl={progress.videoUrl}
            />
          </Section>
        )}

        {showProgress && projectId && (
          <Section title="Progress">
            {progress.error ? (
              <>
                <p className="text-sm text-red-400">Video generation failed: {progress.error}</p>
                <OpenInEditorLink projectId={projectId} />
              </>
            ) : (
              <>
                <p className="text-sm text-primary">
                  {progress.headline}
                  {progress.keyframes.length > 0 && (
                    <span className="text-secondary">
                      {` · ${shotsReady(progress.keyframes.length)}`}
                    </span>
                  )}
                </p>
                <ProgressBar percent={progress.percent} />
                <OpenInEditorLink projectId={projectId} />
              </>
            )}
          </Section>
        )}

        {idea && (
          <Section title="Idea">
            <p className="text-sm font-medium break-words text-primary">{idea.title}</p>
            {idea.hook && <p className="text-sm break-words text-secondary">{idea.hook}</p>}
          </Section>
        )}

        {brief && (
          <Section title="Brief">
            <p className="text-sm font-medium break-words text-primary">
              {brief.title}
              {brief.durationSeconds ? (
                <span className="font-normal text-secondary"> · {brief.durationSeconds}s</span>
              ) : null}
            </p>
            {brief.brief && (
              <p className="text-sm break-words whitespace-pre-line text-secondary">
                {brief.brief}
              </p>
            )}
          </Section>
        )}

        {opening && (
          <Section title="Attention hook">
            <p className="text-sm font-medium break-words text-primary">{opening.title}</p>
            {opening.hook && <p className="text-sm break-words text-secondary">{opening.hook}</p>}
          </Section>
        )}

        {camera && (
          <Section title="Camera">
            <p className="text-sm font-medium break-words text-primary">{camera.title}</p>
            {camera.hook && <p className="text-sm break-words text-secondary">{camera.hook}</p>}
          </Section>
        )}

        {music && (
          <Section title="Music">
            <p className="text-sm font-medium break-words text-primary">{music.title}</p>
            {music.hook && <p className="text-sm break-words text-secondary">{music.hook}</p>}
          </Section>
        )}

        {style && (
          <Section title="Style">
            <div className="flex items-center gap-3">
              {style.thumbnailUrl && (
                <img
                  alt=""
                  className="size-14 shrink-0 rounded-md object-cover"
                  src={style.thumbnailUrl}
                />
              )}
              <span className="min-w-0 text-sm break-words text-primary">
                {style.styleName ?? style.styleId}
              </span>
            </div>
          </Section>
        )}

        {loopLines ? (
          <Section title="Script">
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-primary marker:text-secondary">
              {loopLines.map((line, i) => (
                // One per clip, in order: the position is the clip.
                <li className="break-words" key={i}>
                  {line.narration}
                  {line.stamp && (
                    <span className="ml-2 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-secondary">
                      {line.stamp}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        ) : lines.length > 0 ? (
          <Section title="Script">
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-primary marker:text-secondary">
              {lines.map((line, i) => (
                // Lines can repeat; their position is their identity.
                <li className="break-words" key={i}>
                  {line}
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {showShots && (
          <Section title="Shots">
            <ShotsGrid progress={progress} />
          </Section>
        )}

        {images.length > 0 && (
          <Section title="Images">
            <div className="grid grid-cols-2 gap-2">
              {images.map((entry) => (
                <StoryboardImage entry={entry} key={entry.id} sessionId={sessionId} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </section>
  )
}
