'use client'

import { useCallback, useRef, useState } from 'react'

import type { BrandBriefAsset } from '../state-types'

export interface UseAssetDragDropResult {
  draggedId: null | string
  draggedKind: BrandBriefAsset['kind'] | null
  dragOverKind: BrandBriefAsset['kind'] | null
  handleDragEnd: React.DragEventHandler<HTMLDivElement>
  handleDragLeave: React.DragEventHandler<HTMLDivElement>
  makeDragOverHandler: (kind: BrandBriefAsset['kind']) => React.DragEventHandler<HTMLDivElement>
  makeDragStartHandler: (
    id: string,
    kind: BrandBriefAsset['kind'],
  ) => React.DragEventHandler<HTMLDivElement>
  makeDropHandler: (kind: BrandBriefAsset['kind']) => React.DragEventHandler<HTMLDivElement>
}

export function useAssetDragDrop(
  onChangeKind: (id: string, kind: BrandBriefAsset['kind']) => void,
): UseAssetDragDropResult {
  const [draggedId, setDraggedId] = useState<null | string>(null)
  const [draggedKind, setDraggedKind] = useState<BrandBriefAsset['kind'] | null>(null)
  const [dragOverKind, setDragOverKind] = useState<BrandBriefAsset['kind'] | null>(null)

  // Refs let makeDropHandler read current drag identity from a stable closure
  // without adding draggedId/draggedKind to its dependency array. Those values change
  // on every dragOver and would otherwise recreate all drop handlers on each move.
  const draggedIdRef = useRef<null | string>(null)
  const draggedKindRef = useRef<BrandBriefAsset['kind'] | null>(null)

  const makeDragStartHandler = useCallback(
    (id: string, kind: BrandBriefAsset['kind']): React.DragEventHandler<HTMLDivElement> =>
      (e) => {
        draggedIdRef.current = id
        draggedKindRef.current = kind
        setDraggedId(id)
        setDraggedKind(kind)
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move'
        }
      },
    [],
  )

  const handleDragEnd: React.DragEventHandler<HTMLDivElement> = useCallback(() => {
    draggedIdRef.current = null
    draggedKindRef.current = null
    setDraggedId(null)
    setDraggedKind(null)
    setDragOverKind(null)
  }, [])

  const makeDragOverHandler = useCallback(
    (kind: BrandBriefAsset['kind']): React.DragEventHandler<HTMLDivElement> =>
      (e) => {
        e.preventDefault()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = kind === draggedKindRef.current ? 'none' : 'move'
        }
        setDragOverKind(kind)
      },
    [],
  )

  const handleDragLeave: React.DragEventHandler<HTMLDivElement> = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverKind(null)
    }
  }, [])

  const makeDropHandler = useCallback(
    (kind: BrandBriefAsset['kind']): React.DragEventHandler<HTMLDivElement> =>
      (e) => {
        e.preventDefault()
        const id = draggedIdRef.current
        const fromKind = draggedKindRef.current
        if (id !== null && kind !== fromKind) {
          onChangeKind(id, kind)
        }
        draggedIdRef.current = null
        draggedKindRef.current = null
        setDraggedId(null)
        setDraggedKind(null)
        setDragOverKind(null)
      },
    [onChangeKind],
  )

  return {
    draggedId,
    draggedKind,
    dragOverKind,
    handleDragEnd,
    handleDragLeave,
    makeDragOverHandler,
    makeDragStartHandler,
    makeDropHandler,
  }
}
