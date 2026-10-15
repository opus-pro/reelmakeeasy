import { cn, Slider } from '@shared/ui'
import { memo } from 'react'

import VideoOverlayControls from '@/components/VideoPlayer/VideoOverlayControls'

import { RegenLoadingShimmer } from '../RegenLoadingShimmer'

interface StoryPlayerOverlayProps {
  currentSec: number
  isPlaying: boolean
  onPause: () => void
  onPlay: () => void
  onSeek: (sec: number) => void
  persistSeekBar?: boolean
  showGeneratingShimmer?: boolean
  showPlayButton?: boolean
  statusText?: string
  totalSec: number
}

const StoryPlayerOverlay: React.FC<StoryPlayerOverlayProps> = ({
  currentSec,
  isPlaying,
  onPause,
  onPlay,
  onSeek,
  showGeneratingShimmer = false,
  showPlayButton = true,
  statusText,
  totalSec,
  persistSeekBar = false,
}) => {
  // Normal playback: the shared on-video overlay player (orange seekbar +
  // current/total timestamp + play/pause), identical to the demo and the
  // project/share viewers. Clicking the canvas toggles play/pause.
  if (showPlayButton) {
    return (
      <VideoOverlayControls
        currentTime={currentSec}
        duration={totalSec}
        isPlaying={isPlaying}
        onPause={onPause}
        onPlay={onPlay}
        onSeek={onSeek}
      />
    )
  }

  // Generating / buffering: a non-interactive backdrop (no play affordance while
  // a transition regenerates), optionally with a shimmer, a status line, and a
  // scrub bar for the already-rendered portion.
  const shouldShowSeekBar = totalSec > 0
  const shouldShowBottomOverlay = shouldShowSeekBar || Boolean(statusText)

  return (
    <div className="absolute inset-0 z-20 group">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 backdrop-blur-2xl bg-menu-background/50" />
        <div className="absolute inset-0 bg-black/25" />
        {showGeneratingShimmer ? (
          <RegenLoadingShimmer className="z-[2]" roundedClassName="rounded-none" />
        ) : null}
      </div>

      {shouldShowBottomOverlay && (
        <div
          className={cn(
            'absolute bottom-0 inset-x-0 px-4 pb-4 pt-8 bg-gradient-to-t from-black/50 to-transparent transition-opacity duration-150',
            persistSeekBar
              ? 'opacity-100'
              : isPlaying
                ? 'opacity-0 group-hover:opacity-100'
                : 'opacity-100',
          )}
          // Seek bar / controls must not toggle play/pause.
          onClick={(e) => e.stopPropagation()}
        >
          {statusText && <div className="mb-3 text-sm font-medium text-primary">{statusText}</div>}
          {shouldShowSeekBar && (
            <Slider
              max={totalSec}
              min={0}
              onValueChange={([v]) => onSeek(v)}
              rangeClassName="rounded-l-none rounded-r-full"
              thumbClassName="size-3 bg-fill rounded-full cursor-pointer shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 relative z-10"
              trackClassName="h-[5px] bg-fill-hover"
              value={[currentSec]}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default memo(StoryPlayerOverlay)
