/**
 * Video Plan Block Component
 *
 * Displays a Video Plan Card for user confirmation before video generation.
 * Shows video plan summary (left) and transcript preview (right).
 */

import { Logger } from '@reelmakeeasy/common/utils/logger'
import type { ConfirmProgressiveCardContent } from '@shared/types/chat/embedded-block-shared'
import type { EmbeddedVideoPlanBlock as EmbeddedVideoPlanBlockType } from '@shared/types/chat/message-embedded-block'
import { AGENT_NAMES } from '@shared/types/enums/agent-name'
import { Button, cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { projectReplayModeAtom } from '@/atom/project'
import { Loading } from '@/components/icons/core'
import { useProjectAtom } from '@/hooks/useProjects'

import InnerAgentLogBlock from './inner-agent-log-block'
import { ReferenceSection, TranscriptPreview } from './video-plan-block-parts'

const nsLogger = Logger.get('project.video-plan-block')

type ProjectConfirmState = ConfirmProgressiveCardContent & {
  scriptConfirmed?: boolean
  scriptRefId?: string
}

interface VideoPlanBlockProps {
  msg: EmbeddedVideoPlanBlockType
}

/**
 * Video Plan Block - Main Component
 */
function VideoPlanBlock({ msg }: VideoPlanBlockProps) {
  const content = msg.content
  const { data } = content
  const [hasConfirmed, setHasConfirmed] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const replayMode = useAtomValue(projectReplayModeAtom)
  const { projectInfo } = useProjectAtom()
  const projectConfirm = projectInfo as null | ProjectConfirmState
  const refIdMatches =
    Boolean(projectConfirm?.scriptRefId) && projectConfirm?.scriptRefId === content.refId
  const confirmed = refIdMatches ? projectConfirm?.confirmed : false
  const needConfirm = refIdMatches ? projectConfirm?.needConfirm : false
  const countdown = refIdMatches ? projectConfirm?.countdown : undefined
  const ready = projectConfirm?.ready ?? Boolean(data)

  const isConfirmed =
    confirmed || hasConfirmed || (refIdMatches ? Boolean(projectConfirm?.scriptConfirmed) : false)

  const refs = data?.references
  const hasReferenceDialogContent = Boolean(
    refs && ((refs.images?.length ?? 0) || (refs.links?.length ?? 0) || (refs.docs?.length ?? 0)),
  )

  // Calculate remaining time for countdown
  const remainingSeconds = useMemo(() => {
    if (!countdown?.startedAt || !countdown?.durationMs) {
      return null
    }
    const startTime = new Date(countdown.startedAt).getTime()
    const elapsed = Date.now() - startTime
    return Math.max(0, Math.ceil((countdown.durationMs - elapsed) / 1000))
  }, [countdown])

  const handleConfirm = useCallback(async () => {
    if (isConfirming || hasConfirmed) {
      return
    }
    try {
      setIsConfirming(true)
      // TODO: Call confirm API
      setHasConfirmed(true)
    } catch (error) {
      nsLogger.error('Error confirming video plan:', error)
    } finally {
      setIsConfirming(false)
    }
  }, [isConfirming, hasConfirmed])

  // Track video.plan.viewed when user first sees the Video Plan cards
  const containerRef = useRef<HTMLDivElement>(null)
  const hasTrackedViewed = useRef(false)
  useEffect(() => {
    if (!containerRef.current || hasTrackedViewed.current) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasTrackedViewed.current) {
          hasTrackedViewed.current = true
          observer.disconnect()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [projectInfo?.id, content.refId])

  return (
    <div className="mt-4 flex flex-col gap-4" ref={containerRef}>
      <InnerAgentLogBlock agentName={AGENT_NAMES.DIRECTOR} settled={ready} />
      <div className="@container flex flex-col gap-2">
        {/* Responsive layout: vertical on narrow, horizontal on wide; left column determines height, right adapts */}
        <div className="relative flex flex-col gap-2 @[600px]:flex-row">
          {/* Left Column: Video Plan Info + Reference (content-driven, determines row height) */}
          <div className="flex min-w-0 flex-col gap-2 @[600px]:w-1/2">
            {/* Video Plan Info Card - blue-gray gradient */}
            <div
              className="overflow-hidden rounded-md p-5"
              style={{
                background: 'linear-gradient(145deg, rgb(39, 42, 46) 0%, rgb(29, 29, 29) 70%)',
              }}
            >
              <VideoPlanInfo data={data} />
            </div>

            {/* Reference Card - pink-gray gradient */}
            <div
              className={cn(
                'overflow-hidden rounded-xl p-5',
                hasReferenceDialogContent &&
                  'ring-2 ring-inset ring-transparent transition-shadow duration-200 ease-out hover:ring-[var(--border-subtle)]',
              )}
              style={{
                background: 'linear-gradient(144deg, rgb(44, 39, 43) 0%, rgb(29, 29, 29) 74%)',
              }}
            >
              <ReferenceSection data={data} />
            </div>
          </div>

          {/* Right Column: Transcript Card - positioned to match left column height */}
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl p-5 ring-2 ring-inset ring-transparent transition-shadow duration-200 ease-out hover:ring-[var(--border-subtle)] @[600px]:absolute @[600px]:inset-y-0 @[600px]:right-0 @[600px]:w-[calc(50%-8px)]"
            style={{
              background: 'linear-gradient(146deg, rgb(38, 41, 39) 0%, rgb(29, 29, 29) 81%)',
            }}
          >
            <TranscriptPreview data={data} />
          </div>
        </div>

        {/* Confirm Button */}
        {needConfirm && !replayMode && data && (
          <div className="flex items-center justify-end gap-3">
            {remainingSeconds !== null && remainingSeconds > 0 && !isConfirmed && (
              <span className="text-secondary text-sm">Auto-confirm in {remainingSeconds}s</span>
            )}
            <Button
              className="bg-primary rounded-md text-black"
              disabled={isConfirmed || isConfirming}
              onClick={handleConfirm}
              size="sm"
            >
              {isConfirming && <Loading className="mr-1 animate-spin" />}
              {isConfirmed ? 'Confirmed' : 'Confirm & Start'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Video Plan Info - Basic video information
 * Loading state is determined by whether required data fields exist
 */
function VideoPlanInfo({ data }: { data?: EmbeddedVideoPlanBlockType['content']['data'] }) {
  const hasTitle = Boolean(data?.title)
  const hasTags = data?.styleTags && data.styleTags.length > 0
  const hasMeta = data?.targetAudience || data?.videoType

  // Full skeleton when no data at all
  if (!hasTitle && !hasTags && !hasMeta) {
    return (
      <div className="flex flex-col gap-4">
        {/* Title skeleton */}
        <div className="bg-fill-tertiary h-[22px] w-3/4 rounded" />
        {/* Tags skeleton - pill shape */}
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((idx) => (
            <div className="bg-fill-tertiary h-6 w-24 rounded-xs" key={idx} />
          ))}
        </div>
        {/* Meta info skeleton */}
        <div className="flex flex-col gap-1">
          <div className="bg-fill-tertiary h-[22px] w-64 rounded" />
          <div className="bg-fill-tertiary h-[22px] w-48 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Title */}
      {hasTitle ? (
        <h3 className="text-primary text-lg font-semibold leading-tight">{data?.title}</h3>
      ) : (
        <div className="bg-fill-tertiary h-[22px] w-3/4 rounded" />
      )}

      {/* Style Tags: pill shape, fill-secondary bg, secondary text */}
      {hasTags ? (
        <div className="flex flex-wrap gap-2">
          {data?.styleTags?.map((tag, idx) => (
            <span
              className="rounded-xs bg-fill-secondary px-2 py-1.5 text-primary text-xs font-medium leading-none"
              key={idx}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((idx) => (
            <div className="bg-fill-tertiary h-6 w-24 rounded-full" key={idx} />
          ))}
        </div>
      )}

      {/* Meta Info: secondary text, compact line spacing */}
      {hasMeta ? (
        <div className="text-secondary flex flex-col gap-1 text-sm leading-[22px]">
          {data?.targetAudience && <p>Target audience: {data.targetAudience}</p>}
          {data?.videoType && <p>Video type: {data.videoType}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="bg-fill-tertiary h-[22px] w-64 rounded" />
          <div className="bg-fill-tertiary h-[22px] w-48 rounded" />
        </div>
      )}
    </div>
  )
}

export default memo(VideoPlanBlock)
