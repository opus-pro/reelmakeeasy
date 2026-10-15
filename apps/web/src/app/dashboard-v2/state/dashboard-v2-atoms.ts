import type { QuickStartTemplate } from '@shared/types/assets/quick-start'

import type { QuickStartTemplateSource } from '@/app/story-mode/navigation'
import type { ChatBoxState } from '@/components/omni-chat-box-v2/state/chatbox-state'
import type { CreateUseCaseKey, CreateWorkflow } from '@/constants/create-use-cases'
import { createAtom } from '@/lib/jotai-atom-utils'

const DEFAULT_USE_CASE_KEY_BY_WORKFLOW: Record<CreateWorkflow, CreateUseCaseKey> = {
  'story-mode': 'script-to-video',
}

export const createEmptyTemplateMap = (): Record<
  QuickStartTemplateSource,
  QuickStartTemplate[]
> => ({
  'story-mode': [],
})

export const createInitialMountedWorkflowMap = (): Record<CreateWorkflow, boolean> => ({
  'story-mode': true,
})

type DashboardTemplateDialogState = {
  initialIndex: number
  open: boolean
  templates: QuickStartTemplate[]
}

export const getDefaultUseCaseKeyForWorkflow = (workflow: CreateWorkflow): CreateUseCaseKey =>
  DEFAULT_USE_CASE_KEY_BY_WORKFLOW[workflow]

export const DEFAULT_DASHBOARD_USE_CASE_KEY: CreateUseCaseKey =
  DEFAULT_USE_CASE_KEY_BY_WORKFLOW['story-mode']

export const dashboardSelectedUseCaseKeyAtom = createAtom<CreateUseCaseKey>(
  DEFAULT_DASHBOARD_USE_CASE_KEY,
  'dashboard-v2/selected-use-case-key',
)

export const dashboardMountedWorkflowsAtom = createAtom<Record<CreateWorkflow, boolean>>(
  createInitialMountedWorkflowMap(),
  'dashboard-v2/mounted-workflows',
)

export const dashboardTemplatesBySourceAtom = createAtom<
  Record<QuickStartTemplateSource, QuickStartTemplate[]>
>(createEmptyTemplateMap(), 'dashboard-v2/templates-by-source')

export const dashboardTemplateDialogStateAtom = createAtom<DashboardTemplateDialogState>(
  {
    initialIndex: 0,
    open: false,
    templates: [],
  },
  'dashboard-v2/template-dialog-state',
)

export const dashboardChatBoxVisibleAtom = createAtom<boolean>(true, 'dashboard-v2/chatbox-visible')

export const dashboardChatBoxStateAtom = createAtom<ChatBoxState | undefined>(
  undefined,
  'dashboard-v2/chatbox-state',
)
