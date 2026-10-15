import { cn } from './lib/utils'

export default function CloseButton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'bg-[var(--fill-secondary)] md:hover:bg-[var(--fill-hover)] content-stretch flex gap-[8px] items-center justify-center relative rounded-full size-7 cursor-pointer transition-colors',
        className,
      )}
      data-name="Button Icon Round"
    >
      <div className="relative shrink-0 size-5">
        <div className="absolute inset-[12%]">
          <svg
            className="block max-w-none size-full"
            fill="none"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 6L6 18M6 6L18 18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}
