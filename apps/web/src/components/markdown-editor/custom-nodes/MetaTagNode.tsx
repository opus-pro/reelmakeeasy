import { getMimeTypeFromUrl } from '@reelmakeeasy/common/constant/gemini-file-types'
import { TextMatchTransformer } from '@lexical/markdown'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { Attachment } from '@shared/types/assets/attachment'
import { cn } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import type { LexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import type { JSX } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { attachmentsAtom } from '@/atom/inputBox'
import { DRAG_PROTOCOLS } from '@/components/dnd/drag-protocol'
import { Cross, File } from '@/components/icons/core'
import { AudioPlaybackPill } from '@/components/shared/AudioPlaybackPill'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useImageLightbox } from '@/hooks/use-image-lightbox'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { resolvePlayableAudioUrl, useAudioPlayback } from '@/hooks/useAudioPlayback'
import { formatSecondsToTime } from '@/util/time-utils'

import { MarkdownSerializer } from '../types'

import { getMetaTagDeleteHandler } from './meta-tag-delete-registry'
import { META_TAG_REGEX } from './meta-tag-regex'
import { getMetaTagTooltipRenderer } from './meta-tag-tooltip-registry'
import { getMetaTagTypeHandler } from './meta-tag-type-registry'
import { createTextToSegmentTransformFn } from './segment-transformers'

export type ResourceType = 'audio' | 'file' | 'img' | 'pdf' | 'shot' | 'txt' | 'video' | 'vo'
// META_TAG_REGEX now lives in the dependency-light `./meta-tag-regex` leaf so
// non-UI code (e.g. an attachment parser) and unit tests can reuse it
// without importing this editor module's React/Lexical graph. Re-exported here
// so the many existing `import { META_TAG_REGEX } from '.../MetaTagNode'` sites
// keep working unchanged.
export { META_TAG_REGEX }

export function hasMetaTag(text: string): boolean {
  return META_TAG_REGEX.test(text)
}

/**
 * Extract image/video attachments from text containing meta tags.
 * Parses meta tag syntax like @img[title](resourceId|previewUrl) and converts to Attachment objects.
 */
export function extractAttachmentsFromText(text: string): Attachment[] {
  const globalMetaTagRegex = new RegExp(META_TAG_REGEX.source, 'g')
  const matches = [...text.matchAll(globalMetaTagRegex)]

  return matches
    .filter(([, resourceType]) => resourceType === 'img' || resourceType === 'video')
    .map(([, resourceType, title, resourceId, previewUrl]): Attachment => {
      const mimeType = resourceType === 'video' ? 'video/mp4' : 'image/jpeg'
      return {
        id: resourceId,
        name: title || resourceId,
        type: mimeType,
        url: previewUrl || '',
        size: 0,
        md5: '',
      }
    })
}

export const convertTextToMetaTagNodesFn = createTextToSegmentTransformFn(
  META_TAG_REGEX,
  (match) => {
    const [, resourceType, title, resourceId] = match
    return $createMetaTagNode({
      resourceId,
      resourceType: resourceType as ResourceType,
      title,
    })
  },
)

type MetaTagNodeAttrs = {
  duration?: number
  previewUrl?: string
  resourceId: string
  resourceType: ResourceType
  title: string
}

function parseMetaTag(markdown: string): MetaTagNodeAttrs {
  const match = markdown.match(META_TAG_REGEX)
  if (!match) {
    throw new Error('Invalid meta tag')
  }
  const [, resourceType, title, resourceId] = match
  return {
    resourceId,
    resourceType: resourceType as ResourceType,
    title,
  }
}

const NODE_TYPE = 'meta-tag'

// MetaTag Component with hover effect and preview
export class MetaTagMarkdownSerializer implements MarkdownSerializer<MetaTagNode> {
  fromMarkdownString(markdown: string): MetaTagNode {
    const { resourceId, resourceType, title } = parseMetaTag(markdown)
    return new MetaTagNode(title, resourceId, resourceType)
  }
  toMarkdownString(node: MetaTagNode): string {
    return `@${node.getResourceType()}[${node.getTitle()}](${node.getResourceId()})`
  }
}

export class MetaTagNode extends DecoratorNode<JSX.Element> {
  static serializer = new MetaTagMarkdownSerializer()

  constructor(
    private __title: string,
    private __resourceId: string,
    private __resourceType: ResourceType,
    private __previewUrl?: string,
    private __duration?: number,
    key?: string,
  ) {
    super(key)
  }

  static clone(node: MetaTagNode) {
    return new MetaTagNode(
      node.__title,
      node.__resourceId,
      node.__resourceType,
      node.__previewUrl,
      node.__duration,
      node.__key,
    )
  }

  static getType(): string {
    return NODE_TYPE
  }

  static importJSON(data: object) {
    const { resourceId, resourceType, title, previewUrl, duration } = data as MetaTagNodeAttrs
    return new MetaTagNode(title, resourceId, resourceType, previewUrl, duration)
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span')
    span.setAttribute('data-meta-tag', '')
    return span
  }

  decorate(): JSX.Element {
    return (
      <MetaTagComponent
        duration={this.__duration}
        node={this}
        previewUrl={this.__previewUrl}
        resourceId={this.__resourceId}
        resourceType={this.__resourceType}
        title={this.__title}
      />
    )
  }

  exportJSON() {
    return {
      duration: this.__duration,
      previewUrl: this.__previewUrl,
      resourceId: this.__resourceId,
      resourceType: this.__resourceType,
      title: this.__title,
      type: NODE_TYPE,
      version: 1,
    }
  }

  getDuration(): number | undefined {
    return this.__duration
  }

  getPreviewUrl(): string | undefined {
    return this.__previewUrl
  }

  getResourceId(): string {
    return this.__resourceId
  }

  getResourceType(): ResourceType {
    return this.__resourceType
  }

  getTextContent(): string {
    return MetaTagNode.serializer.toMarkdownString(this)
  }

  getTitle(): string {
    return this.__title
  }

  isInline(): boolean {
    return true
  }

  updateDOM(): boolean {
    return false
  }
}
export function $createMetaTagNode(attr: MetaTagNodeAttrs): MetaTagNode {
  return new MetaTagNode(
    attr.title,
    attr.resourceId,
    attr.resourceType,
    attr.previewUrl,
    attr.duration,
  )
}

export function $isMetaTagNode(node: LexicalNode | null | undefined): node is MetaTagNode {
  return node instanceof MetaTagNode
}

function AudioMetaTagPill({
  attachments,
  isEditable,
  isHovered,
  isSelected,
  onDelete,
  onMouseDown,
  onMouseUp,
  pillRef,
  previewUrl,
  resourceId,
  title,
}: {
  attachments: Attachment[]
  isEditable: boolean
  isHovered: boolean
  isSelected: boolean
  onDelete: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseUp: () => void
  pillRef: React.RefObject<HTMLSpanElement | null>
  previewUrl?: string
  resourceId: string
  title: string
}) {
  const audioPlaybackUrl = useMemo(() => {
    const attachment = attachments.find((att) => att.id === resourceId || att.url === resourceId)
    return resolvePlayableAudioUrl([attachment?.url, previewUrl, resourceId])
  }, [attachments, previewUrl, resourceId])
  const { isPlaying, progress, togglePlayback } = useAudioPlayback(audioPlaybackUrl)

  const handleAudioPlayback = useRefCallback(() => {
    togglePlayback()
  })

  return (
    <AudioPlaybackPill
      className="mx-1 my-px"
      isHighlighted={isSelected || isHovered}
      isPlaying={isPlaying}
      onClose={onDelete}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onPlayPause={handleAudioPlayback}
      progress={progress}
      ref={pillRef}
      showClose={isEditable}
      title={title}
      variant="meta-tag"
    />
  )
}

function MetaTagComponent({
  duration,
  node,
  previewUrl: propPreviewUrl,
  resourceId,
  resourceType,
  title,
}: {
  duration?: number
  node: MetaTagNode
  previewUrl?: string
  resourceId: string
  resourceType: ResourceType
  title: string
}) {
  const [editor] = useLexicalComposerContext()
  const isEditable = useLexicalEditable()
  const attachments = useAtomValue(attachmentsAtom)
  const setAttachments = useSetAtom(attachmentsAtom)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isSelected, setIsSelected] = useState(false)
  const pillRef = useRef<HTMLSpanElement>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const isMetaTagDragEnabled = editor.getRootElement()?.dataset.enableMetaTagDrag !== 'false'

  // Get previewUrl from attachmentsAtom (preferred) or fallback to prop
  const previewUrl = useMemo(() => {
    const attachment = attachments.find((att) => att.id === resourceId || att.url === resourceId)
    return attachment?.url ?? propPreviewUrl
  }, [attachments, resourceId, propPreviewUrl])

  const isImage = resourceType === 'img'
  const isVideo = resourceType === 'video'
  const isPdf = resourceType === 'pdf'
  const isAudio = resourceType === 'audio' || resourceType === 'vo'
  const isFile = resourceType === 'file'

  const {
    close: closeLightbox,
    isOpen: isLightboxOpen,
    triggerProps: lightboxTriggerProps,
  } = useImageLightbox(isImage && Boolean(previewUrl))
  const typeHandler = getMetaTagTypeHandler(editor, resourceType)
  const fallbackResolvedLabel = title
  const resolvedLabel =
    typeHandler?.resolveLabel?.({
      duration,
      fallbackLabel: fallbackResolvedLabel,
      isDragging,
      isEditable,
      isHovered,
      previewUrl,
      resourceId,
      resourceType,
      title,
    }) ?? fallbackResolvedLabel
  const displayLabel = resolvedLabel
  const shouldRenderTitle =
    typeHandler?.shouldRenderTitle?.({
      duration,
      isDragging,
      isEditable,
      isHovered,
      previewUrl,
      resolvedLabel,
      resourceId,
      resourceType,
      title,
    }) ?? resolvedLabel.trim().length > 0
  const hasPreview = previewUrl && (isImage || isVideo)
  const customTooltipRenderer = getMetaTagTooltipRenderer(editor)
  const customTooltipContent =
    customTooltipRenderer?.({
      duration,
      isDragging,
      previewUrl,
      resolvedLabel,
      resourceId,
      resourceType,
      tooltipPosition,
      title,
    }) ?? null
  const shouldShowCustomTooltip = Boolean(customTooltipContent) && isHovered
  const shouldShowPreviewTooltip = isHovered && hasPreview && !shouldShowCustomTooltip

  // Update tooltip position when hovered
  useEffect(() => {
    if (isHovered && pillRef.current) {
      const rect = pillRef.current.getBoundingClientRect()
      setTooltipPosition({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      })
    }
  }, [isHovered])

  // Remove the chip from the editor AND drop the resource from attachmentsAtom.
  // The uploaded-assets surfaces (AnchorAssetsBox / AddAssetsDialog) derive directly
  // from the pool, so leaving the entry behind keeps a deleted image visible there.
  // Undo still renders the chip via the node's own previewUrl prop. The delete handler
  // (registered per editor) lets the host fire analytics at intent time.
  const handleDelete = useCallback(() => {
    getMetaTagDeleteHandler(editor)?.({ resourceId, resourceType, title })
    editor.update(() => {
      const latestNode = node.getLatest()
      latestNode.remove()
    })
    setAttachments((prev) => prev.filter((att) => att.id !== resourceId && att.url !== resourceId))
  }, [editor, node, setAttachments, resourceId, resourceType, title])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isMetaTagDragEnabled) {
      e.preventDefault()
    }
    setIsSelected(true)
  }

  const handleMouseUp = () => {
    setTimeout(() => setIsSelected(false), 150)
  }

  const handleDragStart = (event: ReactDragEvent<HTMLElement>) => {
    if (!isEditable || !isMetaTagDragEnabled) {
      event.preventDefault()
      return
    }

    event.dataTransfer.setData(
      DRAG_PROTOCOLS.metaTagNode.mime,
      DRAG_PROTOCOLS.metaTagNode.serialize({
        sourceNodeKey: node.getKey(),
        resourceId,
        resourceType,
        title,
        previewUrl,
        duration,
      }),
    )
    event.dataTransfer.setData('text/plain', node.getTextContent())
    event.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
    setIsSelected(true)
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    setIsSelected(false)
  }

  // Render the icon/thumbnail or close button on hover
  const renderIcon = useMemo(() => {
    // Show close icon on hover (only when editor is editable)
    if (isHovered && isEditable) {
      return (
        <span
          className="size-[18px] shrink-0 flex items-center justify-center cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handleDelete()
          }}
          // Keep the editor focused: a plain mousedown here blurs the contentEditable,
          // which collapses the engaged composer (omnibox shrinks / mobile sheet exits
          // compose mode) before the click-to-delete even fires.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Cross className="size-4 text-primary" />
        </span>
      )
    }

    if (previewUrl && (isImage || isVideo)) {
      // A video pill may only have the video url itself as its preview (a
      // carried CDN asset with no poster): <img> cannot decode it,
      // so render the first frame via a muted metadata-only <video>. Image
      // previews -- including blob: thumbnail object URLs, which carry no
      // extension and resolve to no mime -- keep the <img> path.
      if (isVideo && (getMimeTypeFromUrl(previewUrl) || '').startsWith('video/')) {
        return (
          <video
            className={cn('size-[18px] object-cover shrink-0 pointer-events-none rounded-[6px]')}
            muted
            playsInline
            preload="metadata"
            src={previewUrl}
          />
        )
      }
      return (
        <img
          alt={title}
          className={cn('size-[18px] object-cover shrink-0 pointer-events-none rounded-[6px]')}
          draggable={false}
          src={previewUrl}
        />
      )
    }

    const customIcon = typeHandler?.renderIcon?.({
      duration,
      isDragging,
      isEditable,
      isHovered,
      previewUrl,
      resourceId,
      resourceType,
      title,
    })
    if (customIcon !== undefined) {
      return customIcon
    }

    if (isPdf || isFile || resourceType === 'shot' || resourceType === 'txt') {
      return <File className="size-[18px] shrink-0 pointer-events-none text-primary" />
    }
    return null
  }, [
    duration,
    isDragging,
    isEditable,
    isFile,
    isHovered,
    isImage,
    isPdf,
    isVideo,
    previewUrl,
    resourceId,
    resourceType,
    title,
    typeHandler,
  ])

  return (
    <span
      className="relative inline align-baseline"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {shouldShowPreviewTooltip &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[60] pointer-events-none"
            style={{
              top: tooltipPosition.top,
              left: tooltipPosition.left,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="bg-foreground rounded-lg shadow-lg">
              <div className="relative">
                {isVideo && (getMimeTypeFromUrl(previewUrl || '') || '').startsWith('video/') ? (
                  <video
                    className="block h-[120px] w-auto rounded-md object-contain"
                    muted
                    playsInline
                    preload="metadata"
                    src={previewUrl}
                  />
                ) : (
                  <img
                    alt={title}
                    className="block h-[120px] w-auto rounded-md object-contain"
                    src={previewUrl}
                  />
                )}
                {isVideo && duration !== undefined && (
                  <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                    {formatSecondsToTime(duration)}
                  </span>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      {shouldShowCustomTooltip &&
        typeof document !== 'undefined' &&
        createPortal(customTooltipContent, document.body)}

      {isLightboxOpen && previewUrl && (
        <ImageLightbox alt={title} onClose={closeLightbox} src={previewUrl} />
      )}

      {/* Asset pill */}
      {isAudio ? (
        <span
          className={cn(
            'inline-flex align-middle',
            isMetaTagDragEnabled && isEditable ? 'cursor-grab active:cursor-grabbing' : '',
          )}
          draggable={isEditable && isMetaTagDragEnabled}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
        >
          <AudioMetaTagPill
            attachments={attachments}
            isEditable={isEditable}
            isHovered={isHovered}
            isSelected={isSelected}
            onDelete={handleDelete}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            pillRef={pillRef}
            previewUrl={previewUrl}
            resourceId={resourceId}
            title={title}
          />
        </span>
      ) : (
        <span
          className={cn(
            'inline-flex items-center gap-1 mx-1 my-px rounded-[10px] bg-white/10 pl-1 pr-1.5 py-0.5 transition-colors align-middle',
            isMetaTagDragEnabled && isEditable
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-pointer',
            isSelected || isHovered ? 'bg-white/[0.16]' : '',
          )}
          draggable={isEditable && isMetaTagDragEnabled}
          onClick={lightboxTriggerProps.onClick}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onKeyDown={lightboxTriggerProps.onKeyDown}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          ref={pillRef}
          role={lightboxTriggerProps.role}
          tabIndex={lightboxTriggerProps.tabIndex}
          title={title}
        >
          {renderIcon}
          {shouldRenderTitle ? (
            <span className="text-primary text-sm leading-[22px] font-normal whitespace-nowrap pointer-events-none">
              {displayLabel}
            </span>
          ) : null}
        </span>
      )}
    </span>
  )
}

export const MetaTagTransformer: TextMatchTransformer = {
  dependencies: [MetaTagNode],
  export: (node) => {
    if (node instanceof MetaTagNode) {
      return MetaTagNode.serializer.toMarkdownString(node)
    }
    return null
  },
  importRegExp: META_TAG_REGEX,
  regExp: META_TAG_REGEX,
  replace: (node, match) => {
    const [, resourceType, title, resourceId, previewUrl] = match
    const metaTagNode = new MetaTagNode(title, resourceId, resourceType as ResourceType, previewUrl)
    node.replace(metaTagNode)
  },
  type: 'text-match',
}
