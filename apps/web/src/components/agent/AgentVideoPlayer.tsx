'use client'

import { cn } from '@shared/ui'
import { useEffect, useRef } from 'react'

import { VideoPlayer } from '@/components/VideoPlayer'

import { claimPlayback } from './exclusivePlayback'

export type AgentVideoPlayerProps = {
  /** The project's aspect ratio, as CSS `w / h`. */
  aspectRatio: string
  /** A still shown before it plays (default: the first frame). */
  poster?: string
  src: string
  /** Size classes for the `<video>` (rounded and letterboxed in black). */
  videoClassName: string
}

/**
 * A finished agent video file with native controls: the fallback where the editor's
 * engine can't play. Its captions are part of the file, as the last render made it.
 * Starting it pauses any other player on the page.
 */
export function AgentVideoPlayer({
  aspectRatio,
  poster,
  src,
  videoClassName,
}: AgentVideoPlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return undefined
    // `play` doesn't bubble, but it does pass through ancestors in the capture phase.
    const onPlay = (event: Event) => claimPlayback({ media: event.target })
    wrapper.addEventListener('play', onPlay, true)
    return () => wrapper.removeEventListener('play', onPlay, true)
  }, [])

  return (
    <div className="w-fit max-w-full" ref={wrapperRef}>
      <VideoPlayer
        ariaLabel="Your video"
        className={cn('max-w-full rounded-lg bg-black object-contain', videoClassName)}
        containerClassName="w-fit max-w-full"
        poster={poster}
        preload="metadata"
        primitiveVideoPlayerProps={{ controls: true, style: { aspectRatio } }}
        // Native controls own play/pause: the wrapper's click-to-toggle would undo them.
        showHoverPlayButton={false}
        src={src}
      />
    </div>
  )
}
