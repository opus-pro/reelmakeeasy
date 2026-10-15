import { Button, Dialog } from '@shared/ui'
import { memo } from 'react'

interface LeaveWarningDialogProps {
  onCancel: () => void
  onConfirm: () => void
  open: boolean
}

const LeaveWarningDialog: React.FC<LeaveWarningDialogProps> = ({ onCancel, onConfirm, open }) => {
  return (
    <Dialog
      classNames={{
        content:
          'bg-menu-background backdrop-blur-2xl border-none rounded-2xl p-6 max-w-[440px] shadow-none',
        description: 'text-secondary text-sm leading-tight',
        footer: 'justify-end gap-2',
        header: 'gap-4 pb-4',
        title: 'text-primary text-lg font-semibold leading-tight',
      }}
      description="Your video is still generating. If you leave now, this progress won't be saved."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            className="rounded-sm px-2.5 hover:bg-white/20"
            onClick={onConfirm}
            variant="secondary"
          >
            Leave anyway
          </Button>
          <Button className="rounded-sm px-2." onClick={onCancel} variant="primary">
            Keep editing
          </Button>
        </div>
      }
      ignoreInteractOutside
      onCancel={onCancel}
      onOpenChange={(isOpen) => !isOpen && onCancel()}
      open={open}
      showClose={false}
      title="Leave while your video is generating?"
    />
  )
}

export default memo(LeaveWarningDialog)
