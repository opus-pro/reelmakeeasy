'use client'

import Dialog from '@shared/ui/dialog'

import { getPublicCdnUrl } from '@/util/cdn-utils'

export interface SongToVideoOnboardingPosterProps {
  onGetStarted: () => void
  open: boolean
}

// Spec: Dashboard / Tutorial design. Full-screen
// rgba(0,0,0,0.9) overlay; centered column with 100px gaps; three 300px-wide
// tutorial steps 80px apart (each a 300x200 illustration + 24px title + 16px
// body); white 38px "Get started" button. Illustrations are the designer's
// exports served from the public CDN (uploaded at 2x for retina).
const STEPS = [
  {
    description: (
      <>
        Add the track you want to transform
        <br />
        into a video.
      </>
    ),
    image: getPublicCdnUrl('assets/song-to-video-onboarding/step-upload-song.png'),
    title: 'Upload a song',
  },
  {
    description: (
      <>Choose the look and feel for your video, or create a custom style of your own.</>
    ),
    image: getPublicCdnUrl('assets/song-to-video-onboarding/step-choose-style.png'),
    title: 'Choose or create a style',
  },
  {
    description: <>Upload any images, clips, brand visuals, or other assets you want to include.</>,
    image: getPublicCdnUrl('assets/song-to-video-onboarding/step-add-assets.png'),
    title: 'Add assets and create',
  },
]

// Per design the white CTA is the only dismiss affordance, so open-state
// change requests from Esc / overlay interaction are intentionally ignored;
// the open prop is fully parent-controlled.
export function SongToVideoOnboardingPoster({
  onGetStarted,
  open,
}: SongToVideoOnboardingPosterProps) {
  return (
    <Dialog
      classNames={{
        // The overlay carries the design's rgba(0,0,0,0.9) backdrop; the
        // content is a transparent full-screen layout container on top.
        // !translate-* beats the global .dialog-content transform rule
        // (same trick as BackdropDialog).
        content:
          'left-0 top-0 !translate-x-0 !translate-y-0 z-[91] flex h-dvh w-screen max-w-none flex-col items-center gap-0 rounded-none border-none bg-transparent p-0 shadow-none',
        overlay: 'z-[90] bg-black/90',
      }}
      description="Turn your music into a complete video that matches the track's mood, rhythm, and creative direction."
      footer={null}
      header={null}
      // Per design the white CTA is the only dismiss affordance: no close
      // button, and Esc / outside interaction must not close the poster.
      ignoreInteractOutside
      onOpenChange={ignoreOpenChange}
      open={open}
      showClose={false}
      title="Create a video from a song"
    >
      <div className="flex min-h-px w-full flex-1 flex-col items-center justify-center gap-[100px]">
        {/* Title */}
        <div className="flex w-full flex-col items-center justify-center gap-[12px] text-center">
          <p className="w-full text-[36px] font-semibold leading-[39.6px] tracking-[-1.08px] text-white">
            Create a video from a song
          </p>
          <p className="w-full text-[16px] font-medium leading-[20px] text-white/50">
            Turn your music into a complete video that matches the track&rsquo;s mood, rhythm, and
            creative direction.
          </p>
        </div>

        {/* Tutorial steps */}
        <div className="flex w-full items-center justify-center">
          <div className="flex items-start justify-center gap-[80px]">
            {STEPS.map((step) => (
              <div className="flex w-[300px] flex-col gap-[16px]" key={step.title}>
                <img alt="" aria-hidden="true" className="h-[200px] w-[300px]" src={step.image} />
                <div className="flex w-full flex-col gap-[4px] text-center">
                  <p className="w-full text-[24px] font-semibold leading-[28.8px] tracking-[-0.6px] text-white">
                    {step.title}
                  </p>
                  <p className="w-full text-[16px] font-normal leading-[26px] tracking-[-0.12px] text-white/50">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          className="flex h-[38px] min-w-[38px] cursor-pointer items-center justify-center gap-[6px] rounded-[10px] bg-white px-[10px]"
          onClick={onGetStarted}
          type="button"
        >
          <span className="px-[2px] text-[14px] font-medium leading-[17px] text-black">
            Get started
          </span>
        </button>
      </div>
    </Dialog>
  )
}

function ignoreOpenChange() {
  // intentionally empty
}
