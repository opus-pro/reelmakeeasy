'use client'

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { X } from 'lucide-react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

import { cn } from '../../lib/utils'

import {
  ALERT_CANCEL_CLASS,
  ALERT_CLOSE_CLASS,
  ALERT_CONFIRM_CLASS,
  ALERT_CONTENT_CLASS,
  ALERT_FOOTER_CLASS,
  ALERT_HEADER_CLASS,
  ALERT_TITLE_CLASS,
  DESCRIPTION_CLASS,
  OVERLAY_CLASS,
} from './classes'
import type { ModalActionEvent, ModalAlertConfig, ModalAlertHandle } from './types'
import { hasContent } from './utils'

// Screen readers need a dialog name even when the caller shows no title.
const FALLBACK_TITLE = 'Alert'

interface ModalAlertProps {
  config: ModalAlertConfig
  /** Closes the alert; the host unmounts it afterwards. */
  onDismiss: () => void
  open: boolean
}

function ModalAlert({ config, onDismiss, open }: ModalAlertProps): React.ReactElement {
  const {
    cancelButtonProps,
    cancelText,
    classNames,
    closeIcon,
    confirmButtonProps,
    confirmText,
    content,
    description,
    onCancel,
    onClose,
    onConfirm,
    showClose = true,
    title,
  } = config
  const hasDescription = hasContent(description)

  // Each button runs its callback and then closes, even if the callback calls preventDefault().
  const handleCancel = (event: ModalActionEvent) => {
    onCancel?.(event)
    onDismiss()
  }
  const handleClose = (event: ModalActionEvent) => {
    if (onClose) onClose()
    else onCancel?.(event)
    onDismiss()
  }
  const handleConfirm = (event: ModalActionEvent) => {
    onConfirm?.(event)
    onDismiss()
  }

  return (
    <AlertDialogPrimitive.Root
      onOpenChange={(next) => {
        if (!next) onDismiss()
      }}
      open={open}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={cn(OVERLAY_CLASS, classNames?.overlay)} />
        <AlertDialogPrimitive.Content
          className={cn(ALERT_CONTENT_CLASS, classNames?.content)}
          // Without a description, drop aria-describedby so Radix does not point it at a missing node.
          {...(hasDescription ? {} : { 'aria-describedby': undefined })}
        >
          <div className={cn(ALERT_HEADER_CLASS, classNames?.header)}>
            {showClose && (
              <AlertDialogPrimitive.Cancel className={ALERT_CLOSE_CLASS} onClick={handleClose}>
                {closeIcon === undefined ? (
                  <>
                    <X className="size-4" />
                    <span className="sr-only">Close</span>
                  </>
                ) : (
                  closeIcon
                )}
              </AlertDialogPrimitive.Cancel>
            )}
            <AlertDialogPrimitive.Title className={cn(ALERT_TITLE_CLASS, classNames?.title)}>
              {hasContent(title) ? title : FALLBACK_TITLE}
            </AlertDialogPrimitive.Title>
            {hasDescription && (
              <AlertDialogPrimitive.Description
                className={cn(DESCRIPTION_CLASS, classNames?.description)}
              >
                {description}
              </AlertDialogPrimitive.Description>
            )}
          </div>
          {content}
          <div className={cn(ALERT_FOOTER_CLASS, classNames?.footer)}>
            {hasContent(cancelText) && (
              <AlertDialogPrimitive.Cancel
                {...cancelButtonProps}
                className={cn(ALERT_CANCEL_CLASS, cancelButtonProps?.className)}
                onClick={handleCancel}
              >
                {cancelText}
              </AlertDialogPrimitive.Cancel>
            )}
            {hasContent(confirmText) && (
              <AlertDialogPrimitive.Action
                {...confirmButtonProps}
                className={cn(ALERT_CONFIRM_CLASS, confirmButtonProps?.className)}
                onClick={handleConfirm}
              >
                {confirmText}
              </AlertDialogPrimitive.Action>
            )}
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

// Server render: there is no document to mount into, so the handle does nothing.
const INERT_HANDLE: ModalAlertHandle = { destroy: () => undefined, update: () => undefined }

/**
 * Opens an alert dialog outside any render tree and returns a handle to update or close it.
 * The alert also closes itself when a button is clicked or Escape is pressed.
 *
 * @example
 * const handle = alert({ title: 'Session expired', confirmText: 'Sign in', onConfirm: signIn })
 * handle.update({ title: 'Still expired' })
 * handle.destroy()
 */
export function alert(config: ModalAlertConfig): ModalAlertHandle {
  if (typeof document === 'undefined') return INERT_HANDLE

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let current = config
  let closed = false

  const render = () => {
    root.render(<ModalAlert config={current} onDismiss={destroy} open={!closed} />)
  }

  function destroy() {
    if (closed) return
    closed = true
    render()
    setTimeout(() => {
      root.unmount()
      host.remove()
    }, 0)
  }

  render()

  return {
    destroy,
    update: (configUpdate) => {
      if (closed) return
      current =
        typeof configUpdate === 'function' ? configUpdate(current) : { ...current, ...configUpdate }
      render()
    },
  }
}
