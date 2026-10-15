'use client'

import { cn, Dialog } from '@shared/ui'
import React from 'react'

export type BackdropDialogProps = {
  children: React.ReactNode
  contentClassName?: string
  disableInteraction?: boolean
  ignoreInteractOutside?: boolean
  maskClassName?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  title?: React.ReactNode
}

export const BackdropDialog: React.FC<BackdropDialogProps> = ({
  children,
  contentClassName,
  disableInteraction = false,
  ignoreInteractOutside = false,
  maskClassName,
  onOpenChange,
  open,
  title,
}) => {
  return (
    <Dialog
      classNames={{
        content: cn(
          '!z-[91] flex border-none p-0 gap-0 overflow-visible shadow-none max-w-none max-h-[min(560px,calc(100dvh-32px))] w-auto bg-transparent rounded-none backdrop-blur-2xl',
          'max-sm:inset-0 max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:[transform:none!important] max-sm:w-full max-sm:max-w-full max-sm:h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!z-[72]',
          'max-sm:data-[state=open]:!animate-none max-sm:data-[state=closed]:!animate-none',
          disableInteraction && 'pointer-events-none',
          contentClassName,
        ),
        description: 'sr-only',
        header: 'sr-only',
        overlay: cn(
          'z-[90] bg-black/70',
          'max-sm:!z-[71] max-sm:data-[state=open]:!animate-none max-sm:data-[state=closed]:!animate-none',
          maskClassName,
        ),
      }}
      footer={null}
      ignoreInteractOutside={ignoreInteractOutside}
      modal
      onOpenChange={onOpenChange}
      open={open}
      showClose={false}
      title={title}
    >
      {children}
    </Dialog>
  )
}

export default BackdropDialog
