'use client'

import { Check, CircleAlert, X } from 'lucide-react'
import * as React from 'react'
import { type ExternalToast, toast as sonnerToast, Toaster as SonnerToaster } from 'sonner'

import { cn } from '../../lib/utils'

/** Options for `toast.success/warning/error`: sonner's own (duration, id, action, ...). */
type ToastId = number | string

interface ToastPillProps {
  action?: ToastProps['action']
  duration?: number
  id: ToastId
  message: React.ReactNode
  onDismiss?: ToastProps['onDismiss']
  variant: 'error' | 'success' | 'warn'
}

type ToastProps = ExternalToast

const pillButtonClass =
  'flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-transparent p-0 text-sm font-medium text-foreground transition-colors focus-visible:ring-0 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

/**
 * The look of every `toast.*` message: icon, text, an optional action, and a close button for
 * toasts that never time out.
 */
const ToastPill = ({ action, duration, id, message, onDismiss, variant }: ToastPillProps) => (
  <div className="pointer-events-auto inline-flex flex-row items-center justify-start gap-2 rounded-sm bg-[rgba(68,68,68,0.5)] p-2.5 shadow-lg backdrop-blur-2xl">
    <div className={variant === 'success' ? 'text-primary' : 'text-red-500'}>
      {variant === 'success' ? (
        <Check className="size-5 shrink-0" />
      ) : (
        <CircleAlert className="size-5 shrink-0" />
      )}
    </div>
    <div className="text-sm font-normal leading-5 text-primary">{message}</div>
    {action &&
      (React.isValidElement(action) ? (
        action
      ) : (
        <button
          className={cn(pillButtonClass, 'ml-2 h-auto w-auto')}
          onClick={(event) => {
            ;(action as { onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }).onClick(
              event,
            )
            sonnerToast.dismiss(id)
          }}
          type="button"
        >
          {(action as { label: React.ReactNode }).label}
        </button>
      ))}
    {duration === Infinity && (
      <button
        aria-label="Close"
        className={cn(pillButtonClass, 'ml-1 size-4')}
        onClick={() => {
          sonnerToast.dismiss(id)
          onDismiss?.({ id })
        }}
        type="button"
      >
        <X className="size-4" />
      </button>
    )}
  </div>
)

let lastId = 0
const nextId = (): ToastId => {
  lastId += 1
  return `toast-${lastId}`
}

const show =
  (variant: ToastPillProps['variant']) => (message: React.ReactNode, props?: ToastProps) => {
    const id = props?.id ?? nextId()
    return sonnerToast(
      <ToastPill
        action={props?.action}
        duration={props?.duration}
        id={id}
        message={message}
        onDismiss={props?.onDismiss}
        variant={variant}
      />,
      { ...props, id },
    )
  }

/**
 * Show a message at the top of the screen. Mount one `<Toaster />` first.
 *
 * @example
 * toast.success('Saved')
 * toast.error('Something went wrong', { duration: Infinity })
 */
const toast = {
  /** Show your own element; gets the toast id to dismiss itself with. */
  custom: (render: (id: ToastId) => React.ReactElement, data?: ExternalToast): ToastId => {
    const id = data?.id ?? nextId()
    sonnerToast(render(id), { ...data, id })
    return id
  },
  /** Close one toast, or all of them when no id is given. */
  dismiss: (id?: ToastId): ToastId => sonnerToast.dismiss(id),
  error: show('error'),
  success: show('success'),
  warning: show('warn'),
}

/** Where toasts appear: top centre, unstyled so each message brings its own look. */
const Toaster = (props: React.ComponentProps<typeof SonnerToaster>) => (
  <SonnerToaster
    className="toaster group"
    offset={20}
    position="top-center"
    toastOptions={{
      className: 'w-full z-[9999]',
      classNames: { title: 'flex items-center justify-center' },
      unstyled: true,
    }}
    {...props}
  />
)

export { toast, Toaster, ToastPill, type ToastProps }
