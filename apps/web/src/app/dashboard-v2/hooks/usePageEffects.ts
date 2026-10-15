'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { longTakeEnabledAtom } from '@/atom/home'
import { attachmentsAtom } from '@/atom/inputBox'
import { projectIdAtom } from '@/atom/project'
import type { CreateWorkflow } from '@/constants/create-use-cases'

import {
  dashboardMountedWorkflowsAtom,
  dashboardSelectedUseCaseKeyAtom,
} from '../state/dashboard-v2-atoms'

type Params = {
  selectedWorkflow: CreateWorkflow
}

export function usePageEffects({ selectedWorkflow }: Params) {
  const selectedUseCaseKey = useAtomValue(dashboardSelectedUseCaseKeyAtom)
  const setProjectId = useSetAtom(projectIdAtom)
  const setLongTakeEnabled = useSetAtom(longTakeEnabledAtom)
  const setAttachments = useSetAtom(attachmentsAtom)
  const setMountedWorkflows = useSetAtom(dashboardMountedWorkflowsAtom)

  useEffect(() => {
    setProjectId('')
  }, [setProjectId])

  useEffect(() => {
    setLongTakeEnabled(selectedWorkflow === 'story-mode')
  }, [selectedWorkflow, setLongTakeEnabled])

  useEffect(() => {
    setAttachments([])
  }, [selectedUseCaseKey, setAttachments])

  useEffect(() => {
    setMountedWorkflows((prev) => {
      if (prev[selectedWorkflow]) {
        return prev
      }
      return { ...prev, [selectedWorkflow]: true }
    })
  }, [selectedWorkflow, setMountedWorkflows])
}
