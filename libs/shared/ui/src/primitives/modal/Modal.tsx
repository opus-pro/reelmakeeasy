'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import * as React from 'react'

import { cn } from '../../lib/utils'

import { alert } from './alert'
import {
  DESCRIPTION_CLASS,
  MODAL_CANCEL_CLASS,
  MODAL_CLOSE_CLASS,
  MODAL_CONFIRM_CLASS,
  MODAL_CONTENT_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_TITLE_CLASS,
  OVERLAY_CLASS,
} from './classes'
import type { ModalProps } from './types'
import { hasContent } from './utils'

// Screen readers need a dialog name even when the caller shows no title.
const FALLBACK_TITLE = 'Dialog'

function ModalBase({
  cancelButtonProps,
  cancelText,
  children,
  classNames,
  closeIcon,
  confirmButtonProps,
  confirmText,
  description,
  footer,
  header,
  ignoreInteractOutside,
  modal,
  onCancel,
  onConfirm,
  onOpenAutoFocus,
  onOpenChange,
  onPointerUp,
  open,
  overlay,
  showClose = true,
  title,
}: ModalProps): React.ReactElement {
  const hasTitle = hasContent(title)
  const hasDescription = hasContent(description)

  const titleElement = (
    <DialogPrimitive.Title className={cn(MODAL_TITLE_CLASS, classNames?.title)}>
      {hasTitle ? title : FALLBACK_TITLE}
    </DialogPrimitive.Title>
  )
  const descriptionElement = (
    <DialogPrimitive.Description className={cn(DESCRIPTION_CLASS, classNames?.description)}>
      {hasDescription ? description : null}
    </DialogPrimitive.Description>
  )

  let headerElement: React.ReactNode
  if (header === undefined) {
    headerElement = (
      <div
        className={cn(
          MODAL_HEADER_CLASS,
          !hasTitle && !hasDescription && 'sr-only',
          classNames?.header,
        )}
      >
        {hasTitle ? titleElement : <VisuallyHidden.Root>{titleElement}</VisuallyHidden.Root>}
        {hasDescription ? (
          descriptionElement
        ) : (
          <VisuallyHidden.Root>{descriptionElement}</VisuallyHidden.Root>
        )}
      </div>
    )
  } else {
    // A custom (or no) header still names and describes the dialog for screen readers.
    headerElement = (
      <>
        <VisuallyHidden.Root>
          {titleElement}
          {descriptionElement}
        </VisuallyHidden.Root>
        {header}
      </>
    )
  }

  let footerElement: React.ReactNode = footer
  if (footer === undefined) {
    const { className: cancelClassName, ...cancelRest } = cancelButtonProps ?? {}
    const { className: confirmClassName, ...confirmRest } = confirmButtonProps ?? {}
    footerElement = (
      <div className={cn(MODAL_FOOTER_CLASS, classNames?.footer)}>
        {hasContent(cancelText) && (
          <button
            className={cn(MODAL_CANCEL_CLASS, cancelClassName)}
            {...cancelRest}
            onClick={onCancel}
          >
            {cancelText}
          </button>
        )}
        {hasContent(confirmText) && (
          <button
            className={cn(MODAL_CONFIRM_CLASS, confirmClassName)}
            type="submit"
            {...confirmRest}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        )}
      </div>
    )
  }

  return (
    <DialogPrimitive.Root modal={modal} onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Portal>
        {overlay === undefined ? (
          <DialogPrimitive.Overlay
            className={cn(OVERLAY_CLASS, classNames?.overlay)}
            onClick={onCancel}
          />
        ) : (
          overlay
        )}
        <DialogPrimitive.Content
          className={cn(MODAL_CONTENT_CLASS, classNames?.content)}
          onInteractOutside={(event) => {
            if (ignoreInteractOutside) event.preventDefault()
          }}
          onOpenAutoFocus={onOpenAutoFocus}
          onPointerUp={onPointerUp}
        >
          {headerElement}
          {children}
          {footerElement}
          {showClose && (
            <DialogPrimitive.Close className={MODAL_CLOSE_CLASS} onClick={onCancel}>
              {closeIcon === undefined ? <Cross2Icon className="size-4" /> : closeIcon}
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Dialog with a title / description / footer layout, built on Radix Dialog.
 * `Modal.alert` opens a one-off alert outside any render tree.
 *
 * @example
 * <Modal open={open} onOpenChange={setOpen} title="Delete clip" confirmText="Delete" cancelText="Cancel" />
 * const handle = Modal.alert({ title: 'Session expired', confirmText: 'Sign in' })
 */
export const Modal: typeof ModalBase & { alert: typeof alert } = Object.assign(ModalBase, { alert })
