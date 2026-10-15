'use client'

import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import type { RefObject } from 'react'

import type { ApplyQuickStartTemplatePayload } from '@/atom/home'
import { useRefCallback } from '@/hooks/use-ref-callback'

interface DashboardTemplateDialogActionsParams {
  closeDialog: () => void
  composerRef: RefObject<HTMLElement | null>
  onDefaultRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void
  onDefaultTemplateChange: (template: QuickStartTemplate) => void
}

export function useDashboardTemplateDialogActions({
  closeDialog,
  composerRef,
  onDefaultRecreate,
  onDefaultTemplateChange,
}: DashboardTemplateDialogActionsParams) {
  const finishInlineRemix = useRefCallback(() => {
    closeDialog()
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  const handleTemplateRecreate = useRefCallback(
    (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => {
      onDefaultRecreate(template, payload)
    },
  )

  const handleTemplateDialogChange = useRefCallback((template: QuickStartTemplate) => {
    onDefaultTemplateChange(template)
  })

  return {
    handleTemplateDialogChange,
    handleTemplateRecreate,
  }
}
