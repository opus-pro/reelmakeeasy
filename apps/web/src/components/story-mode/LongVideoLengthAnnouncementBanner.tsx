import { EXPANDED_STORY_MODE_DISPLAY_MINUTES } from '@reelmakeeasy/common/utils/story-mode-audio-limits'
import { cn } from '@shared/ui'
import type { ReactNode } from 'react'

// Animated length-hint banner shown above a composer. Defaults to the
// story-mode long-video announcement; pass `children` to reuse the same
// slot/styling with different copy (e.g. "up to 3 min").
export function LongVideoLengthAnnouncementBanner({
  children,
  visible,
}: {
  children?: ReactNode
  visible: boolean
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'grid w-full px-6 transition-[grid-template-rows,margin-bottom,opacity] duration-[450ms] ease-in md:px-0',
        visible ? 'mb-6 grid-rows-[1fr] opacity-100' : 'mb-0 grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="flex min-h-0 justify-center overflow-hidden">
        <p className="max-w-full text-center text-[16px] font-medium leading-[20px] text-secondary">
          {children ?? (
            <>
              You can now create videos and upload audio files up to{' '}
              <span className="text-accent-orange">
                {EXPANDED_STORY_MODE_DISPLAY_MINUTES} minutes
              </span>{' '}
              long.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
