import { toast } from '@shared/ui'

export const COPIED_TOAST_DURATION_MS = 2000

/** Canonical share toast: a lime circle with a knockout (cut-out) check on the standard dark pill. */
export function showLinkCopiedToast() {
  toast.custom(
    () => (
      <div className="pointer-events-auto flex min-h-11 w-fit items-center justify-center gap-1.5 rounded-sm bg-menu-background px-6 py-3 shadow-lg backdrop-blur-2xl">
        <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 20 20">
          <mask id="share-link-copied-check">
            <rect fill="white" height="20" width="20" />
            <path
              d="M18.2936 6.79869C18.6841 6.40073 19.3172 6.40068 19.7077 6.79869C20.0981 7.19671 20.0981 7.84196 19.7077 8.23995L11.061 17.0528C10.5119 17.6124 9.64326 17.6469 9.0541 17.1573L8.93984 17.0528L4.29323 12.3169L4.22487 12.2393C3.90451 11.8389 3.9271 11.2488 4.29323 10.8756C4.65936 10.5025 5.2384 10.4795 5.63116 10.806L5.70733 10.8756L9.82365 15.071C9.9213 15.1704 10.0796 15.1705 10.1772 15.071L18.2936 6.79869Z"
              fill="black"
              stroke="black"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
              transform="translate(3 3) scale(0.5833)"
            />
          </mask>
          <circle cx="10" cy="10" fill="#A8E21F" mask="url(#share-link-copied-check)" r="10" />
        </svg>
        <div className="text-primary text-sm font-normal leading-5">Link copied to clipboard</div>
      </div>
    ),
    { duration: COPIED_TOAST_DURATION_MS },
  )
}
