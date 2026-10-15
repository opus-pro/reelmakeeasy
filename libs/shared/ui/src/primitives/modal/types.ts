import type * as React from 'react'

/** Pointer or keyboard event delivered to a Modal footer or close-button handler. */
export type ModalActionEvent = React.MouseEvent<HTMLButtonElement | HTMLDivElement | SVGElement>

/** Slots that accept an extra className from the consumer. */
export type ModalClassNames = Partial<
  Record<'content' | 'description' | 'footer' | 'header' | 'overlay' | 'title', string>
>

/** Props spread onto the cancel / confirm buttons (their onClick is replaced by onCancel / onConfirm). */
export type ModalButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

/** Props of the declarative `Modal` dialog. */
export interface ModalProps {
  /** Props spread onto the cancel button. */
  cancelButtonProps?: ModalButtonProps
  /** Label of the cancel button. The button is omitted when this is absent. */
  cancelText?: React.ReactNode
  /** Body rendered between the header and the footer. */
  children?: React.ReactNode
  /** Per-slot className overrides. */
  classNames?: ModalClassNames
  /** Replaces the default close icon; `null` renders the close button with no icon. */
  closeIcon?: null | React.ReactNode
  /** Props spread onto the confirm button. */
  confirmButtonProps?: ModalButtonProps
  /** Label of the confirm button. The button is omitted when this is absent. */
  confirmText?: React.ReactNode
  /** Secondary text under the title. */
  description?: React.ReactNode
  /** Replaces the default footer; `null` renders no footer. */
  footer?: null | React.ReactNode
  /** Replaces the default title/description header; `null` renders no visible header. */
  header?: null | React.ReactNode
  /** Keeps the modal open on outside interaction. */
  ignoreInteractOutside?: boolean
  /** Renders the dialog as modal, trapping focus and blocking the page. */
  modal?: boolean
  /** Fired by the cancel button, the close button and a click on the default overlay. */
  onCancel?: (e: ModalActionEvent) => void
  /** Fired by the confirm button. */
  onConfirm?: (e: ModalActionEvent) => void
  /** Forwarded to the content's open-autofocus hook. */
  onOpenAutoFocus?: (event: Event) => void
  /** Fired whenever the dialog wants to change its open state. */
  onOpenChange?: (open: boolean) => void
  /** Forwarded to the content element. */
  onPointerUp?: (e: ModalActionEvent) => void
  /** Whether the modal is visible. */
  open: boolean
  /** Custom node rendered instead of the default overlay. */
  overlay?: React.ReactNode
  /** Renders the close button in the top-right corner (default true). */
  showClose?: boolean
  /** Heading text. */
  title?: React.ReactNode
}

/** Config of the imperative `Modal.alert`. */
export interface ModalAlertConfig {
  /** Props spread onto the cancel button. */
  cancelButtonProps?: ModalButtonProps
  /** Label of the cancel button. The button is omitted when this is absent. */
  cancelText?: React.ReactNode
  /** Per-slot className overrides. */
  classNames?: ModalClassNames
  /** Replaces the default close icon; `null` renders the close button with no icon. */
  closeIcon?: null | React.ReactNode
  /** Props spread onto the confirm button. */
  confirmButtonProps?: ModalButtonProps
  /** Label of the confirm button. The button is omitted when this is absent. */
  confirmText?: React.ReactNode
  /** Body of the alert. */
  content?: React.ReactNode
  /** Secondary text under the title. */
  description?: React.ReactNode
  /** Fired by the cancel button and, unless `onClose` is set, by the close button. */
  onCancel?: (e: ModalActionEvent) => void
  /** When set, replaces `onCancel` for the top-right close button only. */
  onClose?: () => void
  /** Fired by the confirm button. */
  onConfirm?: (e: ModalActionEvent) => void
  /** Renders the close button in the top-right corner (default true). */
  showClose?: boolean
  /** Heading text. */
  title?: React.ReactNode
}

/** Handle returned by `Modal.alert`. */
export interface ModalAlertHandle {
  /** Closes the alert and unmounts it on the next macrotask. Does nothing once closed. */
  destroy: () => void
  /** Merges a partial config, or replaces it through an updater function. */
  update: (configUpdate: ((prev: ModalAlertConfig) => ModalAlertConfig) | ModalAlertConfig) => void
}
