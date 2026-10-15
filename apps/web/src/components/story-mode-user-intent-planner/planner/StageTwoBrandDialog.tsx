'use client'

/**
 * Stage 2 brand-brief modal: opens when the user picks paste_url or
 * write_description on the Stage 1 ASK_CLARIFY, in a URL variant and a
 * freeform variant. Closing is via Cancel or outside click; the X affordance
 * belongs to the planner page header behind the overlay.
 */

import { cn, Dialog, toast } from '@shared/ui'
import { useAtom } from 'jotai'
import { $getRoot, type LexicalEditor, type LexicalNode } from 'lexical'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Export } from '@/components/icons/core'
import { MetaTagNode } from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import { useBreakpoint } from '@/util/browserUtils'
import { normalizeUserUrl } from '@/util/validator'

import type { UploadedAsset } from '../adapter/api-types'
import { submitBrandBrief } from '../state/actions/flow-actions'
import { getActiveModalAtom, getApiAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'
import { mapDraftFileType } from '../utils/draft-file-utils'

import { insertAsset } from './rich-text-area-plugins/operations'
import { RichTextArea, type RichTextAreaHandle } from './RichTextArea'

interface PendingUpload {
  blobUrl: string
  draftId: string
  file: File
  promise: Promise<UploadedAsset>
}

type UploadResolution =
  | { status: 'bailed' }
  | { status: 'failed' }
  | { status: 'ok'; text: string; uploaded: UploadedAsset[] }

const DIALOG_CONTENT_BASE =
  'gap-4 rounded-[24px] border-0 bg-menu-background p-4 backdrop-blur-[40px] z-modal sm:rounded-[24px]'
const DIALOG_CONTENT_DESKTOP = `w-[620px] max-w-[620px] ${DIALOG_CONTENT_BASE}`
const DIALOG_CONTENT_MOBILE = `top-[calc(var(--visual-viewport-offset-top,0px)+var(--visual-viewport-height,100dvh)*0.5)] w-[calc(100%-2rem)] max-w-[calc(100%-2rem)] ${DIALOG_CONTENT_BASE}`

export function StageTwoBrandDialog() {
  const state = usePlannerState()
  const [activeModal, setActiveModal] = useAtom(getActiveModalAtom(state))
  const kind = activeModal?.kind === 'brand-create' ? activeModal.mode : null
  const { isBelowMd } = useBreakpoint('md')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<RichTextAreaHandle>(null)
  const pendingUploadsRef = useRef<PendingUpload[]>([])
  const mountedRef = useRef(true)

  const clearPendingUploads = useCallback(() => {
    const items = pendingUploadsRef.current
    if (items.length === 0) {
      return
    }
    const editor = editorRef.current?.getEditor()
    for (const item of items) {
      URL.revokeObjectURL(item.blobUrl)
      if (editor) {
        removeMetaTagByResourceId(editor, item.draftId)
      }
    }
    pendingUploadsRef.current = []
  }, [])

  useEffect(() => {
    // Reset on every mount so React Strict Mode's intentional
    // unmount-remount in dev does not leave the ref stuck at false.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearPendingUploads()
    }
  }, [clearPendingUploads])

  const close = useCallback(() => {
    setActiveModal(null)
  }, [setActiveModal])

  // The planner header X clears the modal atom from outside this
  // component, so field reset follows the atom instead of close().
  useEffect(() => {
    if (kind === null) {
      setUrl('')
      setText('')
      clearPendingUploads()
      setSubmitting(false)
    }
  }, [kind, clearPendingUploads])

  const onSubmit = useCallback(async () => {
    if (!kind) {
      return
    }
    let payload:
      | { kind: 'freeform'; text: string; uploadedAssets?: UploadedAsset[] }
      | { kind: 'url'; url: string }
    if (kind === 'url') {
      const normalized = normalizeUserUrl(url)
      if (!normalized) {
        return
      }
      payload = { kind: 'url', url: normalized }
    } else {
      const trimmedText = text.trim()
      if (!trimmedText) {
        return
      }
      payload = { kind: 'freeform', text: trimmedText }
    }
    setSubmitting(true)

    if (payload.kind === 'freeform' && pendingUploadsRef.current.length > 0) {
      const resolved = await resolvePendingUploads(payload.text, pendingUploadsRef, mountedRef)
      if (resolved.status === 'bailed') {
        return
      }
      if (resolved.status === 'failed') {
        clearPendingUploads()
        toast.error('Failed to upload reference file(s). Please attach them again.')
        setSubmitting(false)
        return
      }
      payload = {
        kind: 'freeform',
        text: resolved.text,
        uploadedAssets: resolved.uploaded,
      }
    }

    const ok = await submitBrandBrief(state, payload)
    if (!mountedRef.current) {
      return
    }
    if (ok) {
      close()
    } else {
      setSubmitting(false)
    }
  }, [kind, url, text, state, close])

  if (kind === 'url') {
    const normalized = normalizeUserUrl(url)
    const submitDisabled = submitting || !normalized
    return (
      <Dialog
        classNames={{
          content: isBelowMd ? DIALOG_CONTENT_MOBILE : DIALOG_CONTENT_DESKTOP,
          overlay: 'bg-black/70 z-modal',
        }}
        footer={
          <UrlVariantFooter
            isBelowMd={isBelowMd}
            onCancel={close}
            onSubmit={onSubmit}
            submitDisabled={submitDisabled}
            submitting={submitting}
          />
        }
        // header={null} suppresses the default DialogHeader; the title
        // renders via VisuallyHidden DialogTitle for a11y while the visible
        // title sits in the custom flex-row below alongside the close X.
        header={null}
        onOpenChange={(next) => {
          if (!next) {
            close()
          }
        }}
        open
        showClose={false}
        title="Paste website link of the brand"
      >
        <h2 className="w-full font-sans text-[18px] font-semibold leading-[21.8px] text-white">
          Paste website link of the brand
        </h2>

        <label className="flex w-full rounded-sm border border-white/10 bg-black/15 p-4">
          <input
            autoFocus
            className="w-full appearance-none border-0 bg-transparent p-0 font-sans text-[16px] leading-[26px] tracking-[-0.12px] text-white placeholder-white/50 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            data-testid="stage-two-brand-modal-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Enter url..."
            type="url"
            value={url}
          />
        </label>
      </Dialog>
    )
  }

  if (kind === 'freeform') {
    const submitDisabled = submitting || !text.trim()

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (files.length === 0) {
        return
      }
      const api = state.get(getApiAtom)
      const editor = editorRef.current?.getEditor()
      if (!api || !editor) {
        return
      }
      // Append to the existing pending batch instead of replacing.
      // Each pick that adds files keeps prior chips + uploads intact;
      // explicit Cancel / close / re-mount is the only path that
      // clears them (clearPendingUploads).
      const promises = api.uploadFiles(files)
      for (const [i, file] of files.entries()) {
        const promise = promises[i]
        if (!promise) {
          continue
        }
        const draftId = crypto.randomUUID()
        const blobUrl = URL.createObjectURL(file)
        pendingUploadsRef.current.push({
          blobUrl,
          draftId,
          file,
          promise,
        })
        insertAsset(editor, {
          id: draftId,
          label: file.name,
          previewUrl: blobUrl,
          type: mapDraftFileType(file.type),
        })
      }
    }

    return (
      <Dialog
        classNames={{
          content: isBelowMd ? DIALOG_CONTENT_MOBILE : DIALOG_CONTENT_DESKTOP,
          overlay: 'bg-black/70 z-modal',
        }}
        footer={
          <FreeformVariantFooter
            fileInputRef={fileInputRef}
            isBelowMd={isBelowMd}
            onCancel={close}
            onFileChange={handleFileChange}
            onSubmit={onSubmit}
            submitDisabled={submitDisabled}
            submitting={submitting}
          />
        }
        header={null}
        onOpenChange={(next) => {
          if (!next) {
            close()
          }
        }}
        open
        showClose={false}
        title="Write brand description"
      >
        <h2 className="w-full font-sans text-[18px] font-semibold leading-[21.8px] text-white">
          Write brand description
        </h2>

        <div className="max-h-[480px] min-h-[200px] w-full overflow-y-auto rounded-sm border border-white/10 bg-black/15 px-3 py-2.5">
          <RichTextArea
            contentEditableClassName="min-h-[180px] w-full font-sans text-[16px] leading-[26px] text-white outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            dataTestId="stage-two-brand-modal-text"
            onChange={setText}
            placeholder="What vibe do you want for the brand?"
            placeholderClassName="text-[14px] leading-[22px] text-white/25"
            ref={editorRef}
            value={text}
          />
        </div>
      </Dialog>
    )
  }

  return null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function FreeformVariantFooter({
  fileInputRef,
  isBelowMd,
  onCancel,
  onFileChange,
  onSubmit,
  submitDisabled,
  submitting,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isBelowMd: boolean
  onCancel: () => void
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSubmit: () => Promise<void>
  submitDisabled: boolean
  submitting: boolean
}) {
  const fileInput = (
    <input
      accept="image/*"
      className="hidden"
      data-testid="stage-two-brand-modal-reference-input"
      multiple
      onChange={onFileChange}
      ref={fileInputRef}
      type="file"
    />
  )

  if (isBelowMd) {
    // Mobile: Submit (white, full-width) on top, then Reference file, then Cancel.
    return (
      <div className="flex w-full flex-col gap-3" data-testid="stage-two-brand-modal-footer">
        <button
          className="flex h-[38px] w-full min-w-[38px] items-center justify-center rounded-sm bg-fill px-2.5 text-[14px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-40 disabled:hover:bg-fill"
          data-dd-action="uip-brand-stage-submit-button"
          data-testid="stage-two-brand-modal-submit"
          disabled={submitDisabled}
          onClick={() => {
            void onSubmit()
          }}
          type="button"
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
        <button
          className="flex h-[38px] w-full items-center justify-center gap-2 rounded-sm bg-fill-secondary px-2.5 text-[14px] font-medium text-white transition-colors hover:bg-fill-hover disabled:opacity-40"
          data-testid="stage-two-brand-modal-reference"
          disabled={submitting}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Export className="size-[18px]" />
          Reference file
        </button>
        {fileInput}
        <button
          className="flex h-[38px] w-full min-w-[38px] items-center justify-center rounded-sm bg-fill-secondary px-2.5 text-[14px] font-medium text-white transition-colors hover:bg-fill-hover"
          data-testid="stage-two-brand-modal-cancel"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    )
  }

  // Desktop: Reference file (left), Cancel + Submit (right).
  return (
    <div className="flex w-full items-center gap-3" data-testid="stage-two-brand-modal-footer">
      <button
        className="flex h-[38px] items-center gap-2 rounded-sm bg-fill-secondary px-2.5 text-[14px] font-medium text-white transition-colors hover:bg-fill-hover disabled:opacity-40"
        data-testid="stage-two-brand-modal-reference"
        disabled={submitting}
        onClick={() => fileInputRef.current?.click()}
        type="button"
      >
        <Export className="size-[18px]" />
        Reference file
      </button>
      {fileInput}
      <div className="ml-auto flex gap-3">
        <button
          className="flex h-[38px] min-w-[38px] items-center justify-center rounded-sm bg-fill-secondary px-2.5 text-[14px] font-medium text-white transition-colors hover:bg-fill-hover"
          data-testid="stage-two-brand-modal-cancel"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="flex h-[38px] min-w-[38px] items-center justify-center rounded-sm bg-fill px-2.5 text-[14px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-40 disabled:hover:bg-fill"
          data-dd-action="uip-brand-stage-submit-button"
          data-testid="stage-two-brand-modal-submit"
          disabled={submitDisabled}
          onClick={() => {
            void onSubmit()
          }}
          type="button"
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  )
}

function removeMetaTagByResourceId(editor: LexicalEditor, resourceId: string): void {
  editor.update(() => {
    $getRoot()
      .getChildren()
      .forEach((paragraph) => {
        if (!('getChildren' in paragraph) || typeof paragraph.getChildren !== 'function') {
          return
        }
        paragraph.getChildren().forEach((child: LexicalNode) => {
          if (child instanceof MetaTagNode && child.getResourceId() === resourceId) {
            child.remove()
          }
        })
      })
  })
}

async function resolvePendingUploads(
  text: string,
  pendingUploadsRef: React.MutableRefObject<PendingUpload[]>,
  mountedRef: React.MutableRefObject<boolean>,
): Promise<UploadResolution> {
  const items = pendingUploadsRef.current
  try {
    const uploaded = await Promise.all(items.map((p) => p.promise))
    if (!mountedRef.current || pendingUploadsRef.current !== items) {
      return { status: 'bailed' }
    }
    const survivors: { item: PendingUpload; uploaded: UploadedAsset }[] = []
    for (const [i, item] of items.entries()) {
      const ud = uploaded[i]
      if (ud && text.includes(item.draftId)) {
        survivors.push({ item, uploaded: ud })
      } else {
        URL.revokeObjectURL(item.blobUrl)
      }
    }
    let rewritten = text
    for (const { item, uploaded: asset } of survivors) {
      rewritten = rewriteDraftAssetReferences(rewritten, item, asset)
    }
    return { status: 'ok', text: rewritten, uploaded: survivors.map((s) => s.uploaded) }
  } catch {
    if (!mountedRef.current || pendingUploadsRef.current !== items) {
      return { status: 'bailed' }
    }
    return { status: 'failed' }
  }
}

function rewriteDraftAssetReferences(
  text: string,
  pending: PendingUpload,
  uploaded: UploadedAsset,
): string {
  const idPattern = new RegExp(escapeRegex(pending.draftId), 'g')
  const blobPattern = new RegExp(escapeRegex(pending.blobUrl), 'g')
  return text.replace(idPattern, uploaded.asset_id).replace(blobPattern, uploaded.file_path)
}

function UrlVariantFooter({
  isBelowMd,
  onCancel,
  onSubmit,
  submitDisabled,
  submitting,
}: {
  isBelowMd: boolean
  onCancel: () => void
  onSubmit: () => Promise<void>
  submitDisabled: boolean
  submitting: boolean
}) {
  return (
    // flex-col-reverse on mobile: DOM order is [Cancel, Submit] but
    // visually reversed so Submit appears on top, matching the Figma.
    <div
      className={cn('flex w-full gap-3', isBelowMd ? 'flex-col-reverse' : 'justify-end')}
      data-testid="stage-two-brand-modal-footer"
    >
      <button
        className={cn(
          'flex h-[38px] min-w-[38px] items-center justify-center rounded-sm bg-fill-secondary px-2.5 text-[14px] font-medium text-white transition-colors hover:bg-fill-hover',
          isBelowMd && 'w-full',
        )}
        data-testid="stage-two-brand-modal-cancel"
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        className={cn(
          'flex h-[38px] min-w-[38px] items-center justify-center rounded-sm bg-fill px-2.5 text-[14px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-40 disabled:hover:bg-fill',
          isBelowMd && 'w-full',
        )}
        data-dd-action="uip-brand-stage-submit-button"
        data-testid="stage-two-brand-modal-submit"
        disabled={submitDisabled}
        onClick={() => {
          void onSubmit()
        }}
        type="button"
      >
        {submitting ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  )
}
