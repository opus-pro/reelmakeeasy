import { CheckMark, Copy, CrossSmall, Globe, Lock } from '@/components/icons/core'

interface ProjectSharePanelProps {
  displayLink: string
  isCopied: boolean
  isPublic: boolean
  onClose?: () => void
  onCopyLink: () => void
  onSelectPrivate: () => void
  onSelectPublic: () => void
}

export function ProjectSharePanel({
  displayLink,
  isCopied,
  isPublic,
  onClose,
  onCopyLink,
  onSelectPrivate,
  onSelectPublic,
}: ProjectSharePanelProps) {
  return (
    <div
      className="flex w-[350px] max-w-[calc(100vw-32px)] flex-col rounded-[16px] bg-[var(--UI-menu-background,rgba(68,68,68,0.50))] [backdrop-filter:blur(calc(var(--Blur,80px)/2))]"
      data-share-panel
    >
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <div className="flex-1 text-base font-medium leading-5 text-white">Share my project</div>
        {onClose && (
          <button
            aria-label="Close"
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors md:hover:bg-white/[0.18]"
            onClick={onClose}
            type="button"
          >
            <CrossSmall className="size-5" />
          </button>
        )}
      </div>

      <div className="flex flex-col p-1.5">
        <button
          className="flex w-full items-center gap-2.5 rounded-xl py-2.5 pl-2.5 pr-4.5 transition-colors md:hover:bg-white/5"
          onClick={onSelectPrivate}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-white/10">
            <Lock className="size-5 text-white" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <div className="text-sm font-medium leading-[17px] text-white">Only me</div>
            <div className="text-xs font-normal leading-[19px] text-white/50">
              Viewable by yourself only
            </div>
          </div>
          {!isPublic && <CheckMark className="size-5 shrink-0 text-white" />}
        </button>

        <button
          className="flex w-full items-center gap-2.5 rounded-xl py-2.5 pl-2.5 pr-4.5 transition-colors md:hover:bg-white/5"
          onClick={onSelectPublic}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-white/10">
            <Globe className="size-5 text-white" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <div className="text-sm font-medium leading-4 text-white">Public access</div>
            <div className="text-xs font-normal leading-5 text-white/50">
              Anyone with the link can view
            </div>
          </div>
          {isPublic && <CheckMark className="size-5 shrink-0 text-white" />}
        </button>
      </div>

      {isPublic && displayLink && (
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          <button
            className="flex h-[38px] w-full items-center gap-1.5 rounded-[10px] bg-white/10 px-2.5 transition-colors md:hover:bg-white/15 disabled:pointer-events-none"
            disabled={isCopied}
            onClick={onCopyLink}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5 px-0.5">
              <div className="flex-1 truncate text-left text-sm font-medium leading-4 text-white">
                {displayLink}
              </div>
            </div>
            {isCopied ? (
              <span className="pointer-events-none shrink-0 text-sm font-medium text-white/50">
                Link copied
              </span>
            ) : (
              <Copy className="pointer-events-none size-4 shrink-0 text-white" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}
