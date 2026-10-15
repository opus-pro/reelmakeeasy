'use client'

import { Button, Dialog } from '@shared/ui'
import { useRouter } from 'next/navigation'

import { Cross, LogoReelMakeEasy } from '@/components/icons/core'

interface ShareAccessDeniedModalProps {
  onClose?: () => void
}

export function ShareAccessDeniedModal({ onClose }: ShareAccessDeniedModalProps) {
  const router = useRouter()

  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      router.push('/')
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleClose()
    }
  }

  return (
    <Dialog
      classNames={{
        content:
          'flex w-[440px] flex-col items-center gap-6 rounded-2xl bg-menu-background p-4 backdrop-blur-2xl border-none',
        overlay: 'bg-black/75 backdrop-blur-[2px]',
      }}
      closeIcon={
        <div className="flex size-7 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20">
          <Cross className="size-4 text-white" />
        </div>
      }
      footer={null}
      header={null}
      onCancel={handleClose}
      onOpenChange={handleOpenChange}
      open={true}
      showClose
    >
      {/* Logo */}
      <div className="flex items-center justify-center p-2">
        <LogoReelMakeEasy className="size-8" />
      </div>

      {/* Text */}
      <div className="flex flex-col items-center gap-1">
        <h2 className="text-center text-2xl font-semibold leading-7 text-white">
          Project not found
        </h2>
        <p className="text-center text-base font-normal leading-6 text-white/50">
          This project either doesn't exist or you don't have permission to access it.
        </p>
      </div>

      {/* Button */}
      <Button
        className="h-9 w-full rounded-sm bg-white/10 px-2.5 text-sm font-medium text-white hover:bg-white/[0.15]"
        onClick={handleClose}
      >
        Back to ReelMakeEasy
      </Button>
    </Dialog>
  )
}
