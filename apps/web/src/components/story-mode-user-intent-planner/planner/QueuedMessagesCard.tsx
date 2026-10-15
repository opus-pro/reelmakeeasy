'use client'

import { cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { ChevronDown, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import { cancelQueuedMessage } from '../state/actions/flow-actions'
import { deleteClientQueuedItem, retryClientQueuedItem } from '../state/actions/send-queue-actions'
import { getRenderStateAtom } from '../state/atoms/planner'
import type { ClientSendQueueItem } from '../state/atoms/send-queue'
import { getSendQueueAtom } from '../state/atoms/send-queue'
import { usePlannerState } from '../state/planner-context'
import type { AssetRef, RenderQueuedMessage } from '../state-types'
import { mapDraftFileType } from '../utils/draft-file-utils'

import { InlineMessageContent } from './InlineMessageContent'
import { GLASS_PANEL_SURFACE, OPAQUE_PANEL_SURFACE } from './panel-surface'

export function QueuedMessagesCard({ opaqueSurface }: { opaqueSurface?: boolean }) {
  const state = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(state))
  const sendQueue = useAtomValue(getSendQueueAtom(state))

  const [expanded, setExpanded] = useState(true)

  // Only pending/error items count as "queued" - the sending item is already in flight
  const clientQueuedItems = sendQueue.filter((item) => item.status !== 'sending')
  const backendItems = renderState.queuedMessages ?? []
  const totalCount = clientQueuedItems.length + backendItems.length

  if (totalCount === 0) {
    return null
  }

  return (
    <section
      className={cn(
        'select-none rounded-[24px] border-[0.5px] border-white/10 p-2',
        opaqueSurface ? OPAQUE_PANEL_SURFACE : GLASS_PANEL_SURFACE,
      )}
      data-testid="uip-queued-card"
    >
      <button
        className="flex h-10 w-full items-center gap-2 rounded-[10px] px-2 text-left hover:bg-white/[0.08]"
        data-testid="uip-queued-toggle"
        onClick={() => {
          setExpanded((value) => !value)
        }}
        type="button"
      >
        <ChevronDown
          className={cn('size-[18px] text-white/50', !expanded && 'rotate-180')}
          strokeWidth={1.5}
        />
        <span
          className="text-[14px] font-medium leading-[17px] text-white/50"
          style={FONT_FEATURE_SETTINGS}
        >
          {buildQueuedLabel(totalCount)}
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col">
          {backendItems.map((item) => (
            <BackendQueueItemRow
              canDelete={item.status !== 'pending'}
              item={item}
              key={item.id}
              onDelete={() => void cancelQueuedMessage(state, item.id)}
            />
          ))}
          {clientQueuedItems.map((item) => (
            <ClientQueueItemRow
              item={item}
              key={item.id}
              onDelete={() => deleteClientQueuedItem(state, item.id)}
              onRetry={() => retryClientQueuedItem(state, item.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function BackendQueueItemRow({
  item,
  canDelete,
  onDelete,
}: {
  canDelete?: boolean
  item: RenderQueuedMessage
  onDelete?: () => void
}) {
  return (
    <div
      className="group flex h-10 w-full items-center gap-2 rounded-[10px] px-2 text-left hover:bg-white/[0.18]"
      data-testid={`uip-queued-item-${item.id}`}
    >
      <span className="inline-block size-4 shrink-0 rounded-[8px] border border-white/50" />
      <span
        className="min-w-0 flex-1 select-text truncate text-[16px] font-normal leading-[26px] tracking-[-0.12px] text-white"
        style={FONT_FEATURE_SETTINGS}
        title={getDisplayMessage(item.text)}
      >
        <QueuedMessageText text={item.text} />
      </span>
      {canDelete ? (
        <button
          className="opacity-0 inline-flex h-8 min-w-8 items-center justify-center rounded-[10px] px-2 text-white/70 group-hover:opacity-100 hover:bg-white/[0.12] hover:text-white"
          data-testid={`uip-queued-remove-${item.id}`}
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.()
          }}
          type="button"
        >
          <Trash2 className="size-4" strokeWidth={1.5} />
        </button>
      ) : null}
    </div>
  )
}

function buildQueuedLabel(count: number): string {
  return count === 1 ? '1 Queued' : `${count} Queued`
}

function ClientQueueItemRow({
  item,
  onDelete,
  onRetry,
}: {
  item: ClientSendQueueItem
  onDelete: () => void
  onRetry: () => void
}) {
  const uploadedAssets = useMemo(
    () =>
      item.draftUploads.map(
        (upload): AssetRef => ({
          id: upload.id,
          label: upload.file.name,
          previewUrl: upload.blobUrl,
          type: mapDraftFileType(upload.file.type),
        }),
      ),
    [item.draftUploads],
  )

  return (
    <div
      className="group flex h-10 w-full items-center gap-2 rounded-[10px] px-2 text-left hover:bg-white/[0.18]"
      data-testid={`uip-queued-client-item-${item.id}`}
    >
      <ClientStatusIcon status={item.status} />
      <span
        className="min-w-0 flex-1 select-text truncate text-[16px] font-normal leading-[26px] tracking-[-0.12px] text-white"
        style={FONT_FEATURE_SETTINGS}
        title={getDisplayMessage(item.message)}
      >
        <QueuedMessageText text={item.message} uploadedAssets={uploadedAssets} />
      </span>
      {item.status === 'error' ? (
        <button
          className="opacity-0 inline-flex h-8 min-w-8 items-center justify-center rounded-[10px] px-2 text-white/70 group-hover:opacity-100 hover:bg-white/[0.12] hover:text-white"
          data-testid={`uip-queued-retry-${item.id}`}
          onClick={(e) => {
            e.stopPropagation()
            onRetry()
          }}
          title={item.errorMessage}
          type="button"
        >
          <RefreshCw className="size-4" strokeWidth={1.5} />
        </button>
      ) : null}
      <button
        className="opacity-0 inline-flex h-8 min-w-8 items-center justify-center rounded-[10px] px-2 text-white/70 group-hover:opacity-100 hover:bg-white/[0.12] hover:text-white"
        data-testid={`uip-queued-remove-${item.id}`}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        type="button"
      >
        <Trash2 className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}

function ClientStatusIcon({ status }: { status: ClientSendQueueItem['status'] }) {
  if (status === 'error') {
    return (
      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-red-400/70 text-[10px] font-bold text-red-400">
        !
      </span>
    )
  }
  // pending
  return <span className="inline-block size-4 shrink-0 rounded-[8px] border border-white/30" />
}

function getDisplayMessage(text: string): string {
  const trimmed = text.trim()
  return trimmed || 'Queued message'
}

function QueuedMessageText({
  text,
  uploadedAssets = [],
}: {
  text: string
  uploadedAssets?: AssetRef[]
}) {
  if (!text.trim()) {
    return <>Queued message</>
  }

  return <InlineMessageContent text={text} uploadedAssets={uploadedAssets} />
}
