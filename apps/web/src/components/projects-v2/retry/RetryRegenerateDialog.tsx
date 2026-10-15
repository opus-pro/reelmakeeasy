'use client'

import { Dialog } from '@shared/ui'

/**
 * Confirm dialog for retrying a failed/cancelled long-take. The
 * retry reuses the source project's artifacts server-side and runs on the
 * default video model, so there is nothing to pick.
 */
export function RetryRegenerateDialog({
  busy,
  canConfirm,
  onConfirm,
  onOpenChange,
  open,
}: {
  busy: boolean
  /** False until the default video model is known. */
  canConfirm: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <Dialog
      classNames={{
        content:
          'z-[91] w-[440px] max-w-[calc(100vw-32px)] rounded-[16px] border-none bg-[rgba(68,68,68,0.5)] p-6 gap-0 shadow-none backdrop-blur-[40px]',
        description: 'sr-only',
        header: 'sr-only',
        overlay: 'z-[91] bg-black/60',
      }}
      footer={null}
      modal
      onOpenChange={onOpenChange}
      open={open}
      showClose={false}
      title="Retry this video"
    >
      <div className="flex w-full flex-col gap-1 pb-4">
        <h2 className="text-lg font-semibold leading-[22px] text-[#fafafa]">Retry this video</h2>
        <p className="text-sm font-normal leading-[22px] text-white/60">
          We&apos;ll create a new version using your same script and assets.
        </p>
      </div>
      <div className="flex w-full items-center justify-end gap-2">
        <button
          className="flex h-[38px] cursor-pointer items-center justify-center rounded-[10px] bg-white/10 px-3 text-sm font-medium leading-[17px] text-white transition-colors hover:bg-white/15"
          disabled={busy}
          onClick={() => onOpenChange(false)}
          type="button"
        >
          Cancel
        </button>
        <button
          className="flex h-[38px] cursor-pointer items-center justify-center rounded-[10px] bg-white px-3 text-sm font-medium leading-[17px] text-black transition-colors hover:bg-white/90 disabled:cursor-default disabled:opacity-60"
          disabled={busy || !canConfirm}
          onClick={onConfirm}
          type="button"
        >
          {busy ? 'Starting…' : 'Regenerate'}
        </button>
      </div>
    </Dialog>
  )
}
