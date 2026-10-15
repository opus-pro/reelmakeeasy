'use client'

// Decorative image at the left of the redesigned confirm gates (the "Confirm
// Panel" design): a 60x80 card tilted -7deg that is intentionally *sliced*
// by an overflow-hidden window shorter than the (rotated) card, so its top and
// bottom read as cropped by the gate edge.
//   - `video` (play glyph) -> creation gates: video-ready + ready-to-roll.
//   - `text` (document lines) -> review gates: storyboard review + brand review.
// Purely decorative, so it is hidden from assistive tech.
export function GateDecorativeImage({ variant }: { variant: 'text' | 'video' }) {
  return (
    <div
      aria-hidden
      className="flex h-[62px] w-[72px] shrink-0 items-center justify-center overflow-hidden"
      data-testid="uip-gate-decorative-image"
      data-variant={variant}
    >
      <div className="relative top-4 shrink-0 rotate-[-7deg]">
        {variant === 'video' ? <VideoCard /> : <TextCard />}
      </div>
    </div>
  )
}

const CARD_CLASS = 'h-20 w-[60px] rounded-xs border border-white/10 bg-white/20'

function TextCard() {
  return (
    <div className={`${CARD_CLASS} flex flex-col items-center justify-center gap-1`}>
      <div className="h-1.5 w-9 rounded-[2px] bg-white/20" />
      <div className="h-1.5 w-9 rounded-[2px] bg-white/20" />
      <div className="flex w-9 flex-col items-start">
        <div className="h-1.5 w-[22px] rounded-[2px] bg-white/20" />
      </div>
    </div>
  )
}

function VideoCard() {
  return (
    <div className={`${CARD_CLASS} flex items-center justify-center`}>
      <svg
        className="text-white/20"
        fill="none"
        height="30"
        viewBox="0 0 30 30"
        width="30"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          clipRule="evenodd"
          d="M15 0C23.2843 0 30 6.71573 30 15C30 23.2843 23.2843 30 15 30C6.71573 30 0 23.2843 0 15C0 6.71573 6.71573 0 15 0ZM11.7031 9.00478C11.0658 9.05687 10.4824 9.36216 10.1025 9.84265C9.66711 10.394 9.66699 11.3646 9.66699 13.3056V16.6943C9.66699 18.6353 9.66711 19.606 10.1025 20.1572C10.4824 20.6377 11.0658 20.943 11.7031 20.9951C12.434 21.0545 13.3215 20.5483 15.0957 19.5361L18.0654 17.8418C19.7119 16.9024 20.5355 16.4328 20.8164 15.8281C21.0615 15.3 21.0615 14.6999 20.8164 14.1718C20.5355 13.5672 19.7119 13.0975 18.0654 12.1582L15.0957 10.4638C13.3215 9.45170 12.434 8.94543 11.7031 9.00478Z"
          fill="currentColor"
          fillRule="evenodd"
        />
      </svg>
    </div>
  )
}
