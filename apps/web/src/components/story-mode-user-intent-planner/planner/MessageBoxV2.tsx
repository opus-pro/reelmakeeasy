'use client'

import { AccentTag, cn, Tooltip } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import { type CSSProperties, type RefObject, useCallback, useEffect, useRef } from 'react'

import { CrossSmall, Plus } from '@/components/icons/core'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useImageLightbox } from '@/hooks/use-image-lightbox'

import { ChatBoxSubmitButton } from '../../omni-chat-box-v2/ChatBoxSubmitButton'
import {
  DEFAULT_COMPOSER_PLACEHOLDER,
  EDIT_ARTIFACT_COMPOSER_PLACEHOLDER,
  isArtifactEditModalKind,
  MODAL_TAG_LABEL,
} from '../defaults'
import {
  enqueueDraftFileUploads,
  removeDraftFileUploadById,
} from '../state/actions/draft-upload-actions'
import {
  clearComposerDraft,
  stopRunningTools,
  submitDraftMessage,
} from '../state/actions/flow-actions'
import type { DraftFileUpload } from '../state/atoms/planner'
import {
  getActiveModalAtom,
  getDraftFileUploadsAtom,
  getDraftMessageAtom,
} from '../state/atoms/planner'
import {
  type ComposerAction,
  getComposerActionAtom,
  getIsAutoModeAtom,
} from '../state/computed/planner'
import { usePlannerState } from '../state/planner-context'
import type { AssetRef } from '../state-types'
import { mapDraftFileType } from '../utils/draft-file-utils'

import { insertAsset } from './rich-text-area-plugins/operations'
import { AutoContinueSelector } from './AutoContinueSelector'
import { MessageTextArea, type MessageTextAreaHandle } from './MessageTextArea'
import {
  CANVAS_GLASS_PANEL_SURFACE,
  GLASS_PANEL_SURFACE,
  OPAQUE_PANEL_SURFACE,
} from './panel-surface'

interface MessageBoxV2Props {
  opaqueSurface?: boolean
  shouldUseCanvasStyle?: boolean
  showAssetStrip?: boolean
}

const BEAM_SEGMENT_INDEXES = Array.from({ length: 12 }, (_, index) => index)

/**
 * The beam, as a chain of short segments rather than one long shape - a long one
 * distorts at the composer's caps and an SVG dash has no falloff along its length, while
 * short segments with an opacity ramp have both. Only the index is set here; the spacing
 * and the ramp are derived from it in .uip-auto-shimmer-ring (tailwind.css), where the
 * reasoning lives. Index 0 is the tail.
 *
 * Both the stroke and the glow layer render one, because a glow covering only part of
 * the beam leaves the rest a bare hairline.
 */
export function MessageBoxV2({
  opaqueSurface,
  showAssetStrip,
  shouldUseCanvasStyle,
}: MessageBoxV2Props) {
  const state = usePlannerState()
  // One button, two modes: Stop while the agent is running something
  // stoppable and the composer is empty, Send otherwise.
  const action = useAtomValue(getComposerActionAtom(state))
  // Auto mode owns the orange accent: the agent can proceed without the
  // user, so the composer carries accent-orange instead of the neutral white.
  const isAutoMode = useAtomValue(getIsAutoModeAtom(state))
  const draft = useAtomValue(getDraftMessageAtom(state))
  const setDraftMessage = useSetAtom(getDraftMessageAtom(state))
  const messageTextAreaRef = useRef<MessageTextAreaHandle>(null)
  // While an artifact edit modal is open the message is scoped to that artifact, so the
  // composer says so permanently: a tag naming the panel plus edit-oriented placeholder
  // copy, matching the tag the sent bubble carries via block.sentFrom.
  // Canvas-only: the below-md dialog renders no edit pane, yet a script/storyboard/
  // voiceover kind can linger in shared plannerState after the viewport crossed below md
  // (see StoryModeUserIntentPlannerDialog's handleCloseClick), which would tag a composer
  // that is not editing anything.
  const activeModal = useAtomValue(getActiveModalAtom(state))
  const editModalKind =
    shouldUseCanvasStyle && activeModal && isArtifactEditModalKind(activeModal.kind)
      ? activeModal.kind
      : null

  // Defensive mount-time clear: covers the QuickQuestionCard -> MessageBoxV2
  // transition where a late OnChangePlugin write-back from the previous
  // composer's editor could otherwise pre-populate this composer's draft.
  useEffect(() => {
    clearComposerDraft(state)
  }, [state])

  const handleSubmit = useCallback(() => submitDraftMessage(state), [state])
  // Enter never stops: with text in the box the button is already Send, and on an
  // empty box submitDraftMessage no-ops -- so Stop stays a deliberate click.
  const handleAction = useCallback(() => {
    if (action.mode === 'stop') {
      void stopRunningTools(state)
      return
    }
    handleSubmit()
  }, [action.mode, handleSubmit, state])

  return (
    <div
      className={cn(
        // uip-composer-edge carries the hairline's colour from the semantic token;
        // the width stays a utility because border-[0.5px] already compiles.
        'relative overflow-visible rounded-[27px] border-[0.5px] p-2 uip-composer-edge',
        // Positioning context for the shimmer layers below.
        isAutoMode && 'uip-auto-shimmer-host',
        // Opaque over the revamped canvas. The white/10
        // hairline stays - with no translucency it is the only edge against the artwork behind.
        // Otherwise canvas mode sits over busy artifact content and needs the heavier glass.
        opaqueSurface
          ? OPAQUE_PANEL_SURFACE
          : shouldUseCanvasStyle
            ? CANVAS_GLASS_PANEL_SURFACE
            : GLASS_PANEL_SURFACE,
        // Hover/focus stroke, one class per mode - Auto 1px accent-orange, Manual
        // 0.5px neutral white. Both live in tailwind.css (.uip-auto-edge-stroke,
        // .uip-manual-edge-stroke) rather than as arbitrary shadow values, because a
        // new arbitrary value in this repo compiles to a class with no CSS behind it.
        // The resting hairline above is untouched in both modes.
        isAutoMode ? 'uip-auto-edge-stroke' : 'uip-manual-edge-stroke',
      )}
    >
      {/* Auto's standing tell: an accent-orange beam running the composer's outline
          while Auto is on. The hover and focus strokes only fire once the pointer or
          caret is already there, so at rest nothing on the composer said which mode
          it was in. Two layers on one clock - see .uip-auto-shimmer in tailwind.css
          for what each does. Decorative, so it is hidden from AT. */}
      {isAutoMode ? (
        <span aria-hidden className="uip-auto-shimmer">
          <span className="uip-auto-shimmer-bloom">
            <span className="uip-auto-shimmer-halo">
              <BeamSegments />
            </span>
          </span>
          <span className="uip-auto-shimmer-ring">
            <BeamSegments />
          </span>
        </span>
      ) : null}

      {showAssetStrip ? <AssetStrip messageTextAreaRef={messageTextAreaRef} /> : null}

      <div className="flex items-center justify-between">
        {editModalKind && (
          // The composer's aria-label already names the artifact, so the tag is a visual
          // echo -- hidden to keep the textbox from being announced twice.
          <div aria-hidden="true" className="pl-1.5" data-testid="uip-composer-v2-modal-tag">
            <AccentTag label={MODAL_TAG_LABEL[editModalKind]} tone="blue" />
          </div>
        )}
        <div className="min-w-0 flex-1 px-3">
          <MessageTextArea
            ariaLabel={
              editModalKind
                ? `${EDIT_ARTIFACT_COMPOSER_PLACEHOLDER} to ${MODAL_TAG_LABEL[editModalKind]}`
                : DEFAULT_COMPOSER_PLACEHOLDER
            }
            onChange={setDraftMessage}
            onEnterPress={handleSubmit}
            placeholder={
              editModalKind ? EDIT_ARTIFACT_COMPOSER_PLACEHOLDER : DEFAULT_COMPOSER_PLACEHOLDER
            }
            placeholderClassName="right-0 truncate"
            ref={messageTextAreaRef}
            value={draft}
          />
        </div>

        <AutoContinueSelector />

        <ChatBoxSubmitButton
          // A disabled Stop is the "stop already sent, waiting on the tool" state;
          // say so, otherwise the button just goes silently dead for screen readers.
          ariaLabel={actionLabel(action)}
          canPress={action.canPress}
          className="self-end"
          dataDdAction="uip-composer-submit-prompt-button"
          dataTestId="uip-composer-v2-send"
          isAutoMode={isAutoMode}
          mode={action.mode}
          onAbort={handleAction}
          onSend={handleAction}
        />
      </div>
    </div>
  )
}

function actionLabel(action: ComposerAction): string {
  if (action.mode !== 'stop') {
    return 'Send'
  }
  return action.canPress ? 'Stop generating' : 'Stopping'
}

function BeamSegments() {
  return BEAM_SEGMENT_INDEXES.map((index) => (
    <span className="uip-auto-shimmer-orb" key={index} style={{ '--i': index } as CSSProperties} />
  ))
}

// ---------------------------------------------------------------------------
// Asset strip
// ---------------------------------------------------------------------------

function AssetStrip({
  messageTextAreaRef,
}: {
  messageTextAreaRef: RefObject<MessageTextAreaHandle | null>
}) {
  const state = usePlannerState()
  const draftUploads = useAtomValue(getDraftFileUploadsAtom(state))
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = (files: readonly File[]) => {
    if (!files.length) {
      return
    }
    const uploads = enqueueDraftFileUploads(state, files)
    if (!uploads.length) {
      return
    }
    const editor = messageTextAreaRef.current?.getTextArea()?.getEditor()
    if (!editor) {
      return
    }
    for (const upload of uploads) {
      insertAsset(editor, buildAssetRefFromDraftUpload(upload))
    }
  }

  return (
    <div className="flex flex-row flex-wrap gap-2 p-3 pb-1">
      <Tooltip
        arrow
        className="z-[100] rounded-[10px] bg-[#444444] p-2 text-white"
        content={
          <span className="block px-1.5 text-sm leading-[22px] font-normal text-white">
            Add asset
          </span>
        }
        delayDuration={0}
        side="top"
        sideOffset={8}
      >
        <button
          className="flex size-[72px] flex-shrink-0 items-center justify-center rounded-[10px] border-2 border-dashed border-white/10 text-white transition hover:border-white/20"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Plus className="size-5" />
        </button>
      </Tooltip>
      <input
        accept="image/*"
        className="hidden"
        multiple
        onChange={(e) => {
          uploadFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
        ref={fileInputRef}
        type="file"
      />

      {draftUploads.map((upload) => (
        <DraftThumbnail
          key={upload.id}
          onRemove={() => removeDraftFileUploadById(state, upload.id)}
          upload={upload}
        />
      ))}

      {/* One live region for the whole strip rather than one per chip: an upload settling is a
          single event to announce, and this sits outside every chip's trigger, whose contents a
          screen reader may prune as presentational. `sr-only` is absolutely positioned, so it
          takes no room in the flex row. */}
      <span aria-live="polite" className="sr-only" role="status">
        {draftUploads.map(draftUploadStatedName).filter(Boolean).join('. ')}
      </span>
    </div>
  )
}

/**
 * `<name>, <state>` while an upload is in flight or has failed, else null. Shared so the chip's
 * accessible name and the strip's live region word the same state the same way.
 */
function buildAssetRefFromDraftUpload(upload: DraftFileUpload): AssetRef {
  return {
    id: upload.id,
    label: upload.file.name,
    previewUrl: upload.file.type.startsWith('image/') ? upload.blobUrl : undefined,
    type: mapDraftFileType(upload.file.type),
  }
}

function DraftThumbnail({ onRemove, upload }: { onRemove: () => void; upload: DraftFileUpload }) {
  const fetchState = upload.fetcher.data.state
  const isImage = upload.file.type.startsWith('image/')
  const {
    close: closeLightbox,
    isOpen: isLightboxOpen,
    triggerProps: lightboxTriggerProps,
  } = useImageLightbox(isImage)
  // The spinner and the `!` badge are the only signal that an upload is in flight or has
  // failed, and neither carries text. The strip's live region announces the transition; this
  // carries the same state into the chip's own name, so it is still there for anyone who
  // arrives after the announcement. An accessible name replaces an element's contents, hence
  // the name where there is a trigger and the contents where there is not.
  const uploadStatus = draftUploadStatedName(upload)
  const statedName = uploadStatus ?? upload.file.name
  return (
    <div
      aria-label={lightboxTriggerProps.role ? `Expand ${statedName}` : undefined}
      className={cn(
        'relative size-18 shrink-0 rounded-xs bg-white/5',
        lightboxTriggerProps.role && 'cursor-zoom-in',
      )}
      {...lightboxTriggerProps}
    >
      <img
        alt={upload.file.name}
        className="size-full rounded-xs object-cover"
        src={upload.blobUrl}
      />
      {fetchState === 'pending' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}
      {fetchState === 'rejected' && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
          <span aria-hidden="true" className="text-[10px] text-white">
            !
          </span>
        </div>
      )}
      {!lightboxTriggerProps.role && uploadStatus && <span className="sr-only">{statedName}</span>}
      {/* A touch device has no hover state, so this stays visible -- gating it behind hover puts
          the only way to unstage an upload out of reach there. */}
      <button
        aria-label={`Remove ${upload.file.name}`}
        className="absolute right-0 top-0 z-20 inline-flex size-5 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white shadow-sm transition hover:bg-black/90"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onRemove()
        }}
        type="button"
      >
        <CrossSmall className="size-3" />
      </button>
      {isLightboxOpen && (
        <ImageLightbox alt={upload.file.name} onClose={closeLightbox} src={upload.blobUrl} />
      )}
    </div>
  )
}

function draftUploadStatedName(upload: DraftFileUpload): null | string {
  const fetchState = upload.fetcher.data.state
  if (fetchState === 'pending') {
    return `${upload.file.name}, uploading`
  }
  return fetchState === 'rejected' ? `${upload.file.name}, upload failed` : null
}
