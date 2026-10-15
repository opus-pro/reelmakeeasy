'use client'

import { Button, Dialog } from '@shared/ui'

export function DeleteStyleDialog({
  isDeleting,
  onCancel,
  onConfirm,
  pendingDeleteStyle,
}: {
  isDeleting: boolean
  onCancel: () => void
  onConfirm: () => void
  pendingDeleteStyle: null | { id: string; name: string }
}) {
  return (
    <Dialog
      classNames={{
        content:
          'z-[96] backdrop-blur-2xl bg-menu/50 border-tertiary rounded-2xl p-6 max-w-[440px] max-sm:max-w-[90%]',
        description: 'text-secondary text-sm leading-[22px]',
        footer: 'gap-2 justify-end pt-4',
        overlay: 'z-[95]',
        title: 'text-primary text-lg font-semibold leading-[21.8px]',
      }}
      description={
        pendingDeleteStyle
          ? `This will permanently remove "${pendingDeleteStyle.name}".`
          : undefined
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            className="rounded-sm bg-white/10 px-2.5 hover:bg-white/20"
            disabled={isDeleting}
            onClick={onCancel}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            className="rounded-sm bg-white px-2.5 text-black hover:bg-white/90"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      }
      onCancel={onCancel}
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
      open={Boolean(pendingDeleteStyle)}
      showClose={!isDeleting}
      title="Delete this style?"
    />
  )
}
