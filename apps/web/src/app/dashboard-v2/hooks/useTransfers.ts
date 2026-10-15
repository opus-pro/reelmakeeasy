'use client'

import { useAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'

import {
  RECREATE_QUERY_KEY,
  REMIX_QUERY_KEY,
  USE_THIS_STYLE_QUERY_KEY,
} from '@/app/home/constants/urlTransferKeys'
import type { ApplyLongTakeTemplatePayload, ApplyQuickStartTemplatePayload } from '@/atom/home'
import { pendingRemixAtom, pendingUseThisStyleAtom } from '@/atom/home'
import type { OmniChatBoxRef } from '@/components/omni-chat-box-v2/OmniChatBox'
import type { ChatBoxState } from '@/components/omni-chat-box-v2/state/chatbox-state'
import {
  CREATE_USE_CASE_QUERY_PARAM,
  CREATE_USE_CASES,
  type CreateUseCaseKey,
  type CreateWorkflow,
} from '@/constants/create-use-cases'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useUrlTransfer } from '@/hooks/useUrlTransfer'

import { getDefaultUseCaseKeyForWorkflow } from '../state/dashboard-v2-atoms'
import { dashboardSelectedUseCaseKeyAtom } from '../state/dashboard-v2-atoms'

const RECREATE_TRANSFER_KEYS = [RECREATE_QUERY_KEY] as const
const REMIX_TRANSFER_KEYS = [REMIX_QUERY_KEY] as const
const USE_THIS_STYLE_TRANSFER_KEYS = [USE_THIS_STYLE_QUERY_KEY] as const

type DashboardV2Transfer =
  | {
      payload: ApplyLongTakeTemplatePayload
      type: 'remix'
      useCaseKey?: CreateUseCaseKey
      workflow: CreateWorkflow
    }
  | {
      payload: ApplyLongTakeTemplatePayload
      type: 'use-this-style'
      useCaseKey?: CreateUseCaseKey
      workflow: CreateWorkflow
    }
  | {
      payload: ApplyQuickStartTemplatePayload
      type: 'recreate'
      useCaseKey?: CreateUseCaseKey
      workflow: CreateWorkflow
    }

type Params = {
  chatBoxRef: React.RefObject<HTMLDivElement | null>
  chatBoxState: ChatBoxState | undefined
  // On the mobile layout the OmniChatBox is absent on /home. DashboardV2 handles
  // atom-based card actions (remix/copy-style) via URL transfer + navigation to
  // /create, so the atom watchers here must be skipped to avoid double-processing.
  isMobileLayout?: boolean
  mountedChatBoxWorkflow: CreateWorkflow | null
  omniChatBoxRef: React.RefObject<null | OmniChatBoxRef>
  // Receives the queued transfer's resolved target use case so the page can
  // release surfaces that unmount the OmniChatBox before
  // the apply effect needs it.
  onTransferQueued?: (targetUseCaseKey: CreateUseCaseKey) => void
  searchParams: null | SearchParamsLike | undefined
  selectedWorkflow: CreateWorkflow
}

type SearchParamsLike = {
  get: (name: string) => null | string
}

export function useTransfers({
  chatBoxState,
  chatBoxRef,
  isMobileLayout = false,
  mountedChatBoxWorkflow,
  onTransferQueued,
  omniChatBoxRef,
  searchParams,
  selectedWorkflow,
}: Params) {
  const [selectedUseCaseKey, setSelectedUseCaseKey] = useAtom(dashboardSelectedUseCaseKeyAtom)
  const pendingTransferRef = useRef<DashboardV2Transfer | null>(null)
  const scrollRafRef = useRef<null | number>(null)
  const [pendingTransferVersion, setPendingTransferVersion] = useState(0)

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [])

  const queueTransfer = useRefCallback((transfer: DashboardV2Transfer) => {
    pendingTransferRef.current = transfer
    const targetUseCaseKey =
      transfer.useCaseKey || getDefaultUseCaseKeyForWorkflow(transfer.workflow)
    if (targetUseCaseKey !== selectedUseCaseKey) {
      setSelectedUseCaseKey(targetUseCaseKey)
    }
    setPendingTransferVersion((prev) => prev + 1)
    onTransferQueued?.(targetUseCaseKey)
  })

  const handleUseThisStyleTransfer = useRefCallback(
    (payload: ApplyLongTakeTemplatePayload | null) => {
      if (!payload) {
        return
      }

      queueTransfer({
        payload,
        type: 'use-this-style',
        useCaseKey: 'script-to-video',
        workflow: 'story-mode',
      })
    },
  )
  useUrlTransfer(USE_THIS_STYLE_TRANSFER_KEYS, handleUseThisStyleTransfer)

  const handleRecreateTransfer = useRefCallback(
    (payload: ApplyQuickStartTemplatePayload | null) => {
      if (!payload) {
        return
      }

      const useCaseFromQuery = searchParams?.get(CREATE_USE_CASE_QUERY_PARAM)
      const targetUseCase = CREATE_USE_CASES.find((item) => item.key === useCaseFromQuery)

      queueTransfer({
        payload,
        type: 'recreate',
        useCaseKey: targetUseCase?.key,
        workflow: targetUseCase?.workflow ?? 'story-mode',
      })
    },
  )
  useUrlTransfer(RECREATE_TRANSFER_KEYS, handleRecreateTransfer)

  const handleRemixTransfer = useRefCallback((payload: ApplyLongTakeTemplatePayload | null) => {
    if (!payload) {
      return
    }

    queueTransfer({
      payload,
      type: 'remix',
      useCaseKey: 'script-to-video',
      workflow: 'story-mode',
    })
  })
  useUrlTransfer(REMIX_TRANSFER_KEYS, handleRemixTransfer)

  // Watch atom-based pending templates from same-page card button actions
  // (copy style / remix buttons on TemplateVideoCard set these atoms directly).
  // On the mobile layout, DashboardV2 intercepts these atoms first, converts them to
  // URL transfers, and navigates to /create -- so we skip processing here.
  const [atomPendingStyle, setAtomPendingStyle] = useAtom(pendingUseThisStyleAtom)
  const [atomPendingRemix, setAtomPendingRemix] = useAtom(pendingRemixAtom)

  useEffect(() => {
    if (!atomPendingStyle || isMobileLayout) {
      return
    }
    queueTransfer({
      payload: atomPendingStyle,
      type: 'use-this-style',
      useCaseKey: 'script-to-video',
      workflow: 'story-mode',
    })
    setAtomPendingStyle(null)
  }, [atomPendingStyle, isMobileLayout, queueTransfer, setAtomPendingStyle])

  useEffect(() => {
    if (!atomPendingRemix || isMobileLayout) {
      return
    }
    queueTransfer({
      payload: atomPendingRemix,
      type: 'remix',
      useCaseKey: 'script-to-video',
      workflow: 'story-mode',
    })
    setAtomPendingRemix(null)
  }, [atomPendingRemix, isMobileLayout, queueTransfer, setAtomPendingRemix])

  useEffect(() => {
    const pendingTransfer = pendingTransferRef.current
    if (!pendingTransfer || pendingTransfer.workflow !== selectedWorkflow) {
      return
    }

    const chatBoxApi = omniChatBoxRef.current
    if (!chatBoxApi || !chatBoxState) {
      return
    }

    if (mountedChatBoxWorkflow !== pendingTransfer.workflow) {
      return
    }

    if (pendingTransfer.type === 'recreate') {
      chatBoxApi.applyQuickStartTemplate(pendingTransfer.payload)
    } else {
      chatBoxApi.applyLongTakeTemplate(pendingTransfer.payload)
    }
    pendingTransferRef.current = null

    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current)
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      chatBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrollRafRef.current = null
    })
  }, [
    chatBoxRef,
    chatBoxState,
    mountedChatBoxWorkflow,
    omniChatBoxRef,
    pendingTransferVersion,
    selectedWorkflow,
  ])

  return { queueTransfer }
}
