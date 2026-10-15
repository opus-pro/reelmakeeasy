'use client'
import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { cn } from '@shared/ui'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { QuickStartTemplateDialog } from '@/app/home/components/QuickStartTemplateDialog'
import { REMIX_QUERY_KEY, USE_THIS_STYLE_QUERY_KEY } from '@/app/home/constants/urlTransferKeys'
import { useDeepLinkTemplate } from '@/app/home/hooks/useQuickStartTemplateList'
import {
  OnboardingTour,
  SongToVideoOnboardingTour,
} from '@/app/story-mode/components/OnboardingTour'
import {
  QUICK_START_TEMPLATE_QUERY_KEY,
  QUICK_START_TEMPLATE_SOURCE_QUERY_KEY,
  QuickStartTemplateSource,
} from '@/app/story-mode/navigation'
import {
  pendingRemixAtom,
  pendingUseThisStyleAtom,
  quickStartDeepLinkTemplateAtom,
  quickStartTemplatesAtom,
} from '@/atom/home'
import { attachmentsAtom } from '@/atom/inputBox'
import { mobileCreateUseCaseGridVisibleAtom, resetMobileCreateGridAtom } from '@/atom/ui'
import AppSidebar from '@/components/AppSidebar'
import { EnterPromptCta } from '@/components/EnterPromptCta'
import type { OmniBoxSettings } from '@/components/omni-chat-box-v2/omni-chat-box.types'
import { isStoryModeAudioAttachment } from '@/components/omni-chat-box-v2/omni-chat-box-helpers'
import { OmniChatBox, OmniChatBoxRef } from '@/components/omni-chat-box-v2/OmniChatBox'
import { syncChatBoxMessage } from '@/components/omni-chat-box-v2/state/flows/message'
import { HomeSetupCard } from '@/components/setup/SetupEntry'
import { SongToVideoOnboardingPoster } from '@/components/song-to-video-onboarding/SongToVideoOnboardingPoster'
import { useSongToVideoOnboardingPoster } from '@/components/song-to-video-onboarding/useSongToVideoOnboardingPoster'
import {
  CREATE_USE_CASE_QUERY_PARAM,
  CREATE_USE_CASES,
  type CreateUseCaseKey,
  type CreateWorkflow,
  getCreateUseCase,
  isFocusedCreateUseCaseKey,
} from '@/constants/create-use-cases'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useMutateQuery } from '@/hooks/useMutateQuery'
import { setUrlTransfer } from '@/hooks/useUrlTransfer'
import { useBreakpoint } from '@/util/browserUtils'

import { CreateUseCaseGrid } from './components/CreateUseCaseGrid'
import { setDashboardTopBannerScrollContainer } from './components/dashboard-top-full-banner-global-controller'
import { DashboardIntro } from './components/DashboardIntro'
import { DashboardUseCaseButtons } from './components/DashboardUseCaseButtons'
import { MobileCreateSheet } from './components/MobileCreateSheet'
import { useChatBoxVisibility } from './hooks/useChatBoxVisibility'
import { useDashboardTemplateDialogActions } from './hooks/useDashboardTemplateDialogActions'
import { usePageEffects } from './hooks/usePageEffects'
import { useTransfers } from './hooks/useTransfers'
import { useUseCaseSelect } from './hooks/useUseCaseSelect'
import { useUseCaseSync } from './hooks/useUseCaseSync'
import { useVideoModelDeepLink } from './hooks/useVideoModelDeepLink'
import { StoryModeTemplateList } from './lists/StoryModeTemplateList'
import {
  dashboardChatBoxStateAtom,
  dashboardChatBoxVisibleAtom,
  dashboardMountedWorkflowsAtom,
  dashboardSelectedUseCaseKeyAtom,
  dashboardTemplateDialogStateAtom,
  dashboardTemplatesBySourceAtom,
  getDefaultUseCaseKeyForWorkflow,
} from './state/dashboard-v2-atoms'
import {
  getQuickStartSourceFromTemplate,
  getQuickStartSourceFromWorkflow,
  getWorkflowFromQuickStartSource,
  getWorkflowFromQuickStartTemplate,
  isQuickStartTemplateSource,
  QUICK_START_DEEP_LINK_QUERY_KEYS,
  resolveDeepLinkTemplateLocation,
} from './deep-link-utils'

interface DashboardV2PageProps {
  mode?: 'create' | 'dashboard'
}

export function DashboardV2Page({ mode = 'dashboard' }: DashboardV2PageProps = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { removeQuery, setQuery } = useMutateQuery()
  const { isBelowMd } = useBreakpoint('md')
  const mountedWorkflows = useAtomValue(dashboardMountedWorkflowsAtom)
  const [templatesBySource, setTemplatesBySource] = useAtom(dashboardTemplatesBySourceAtom)
  const [templateDialogState, setTemplateDialogState] = useAtom(dashboardTemplateDialogStateAtom)
  const setSelectedUseCaseKey = useSetAtom(dashboardSelectedUseCaseKeyAtom)
  const setDeepLinkTemplate = useSetAtom(quickStartDeepLinkTemplateAtom)
  const setQuickStartTemplatesAtom = useSetAtom(quickStartTemplatesAtom)
  const isChatBoxVisible = useAtomValue(dashboardChatBoxVisibleAtom)
  const [chatBoxState, setChatBoxState] = useAtom(dashboardChatBoxStateAtom)
  // "Make your first video?" may still open, or is open: the Story Mode tour waits for it (the
  // tour's tooltips sit above dialogs).
  const [firstVideoBusy, setFirstVideoBusy] = useState(true)
  const [mountedChatBoxWorkflow, setMountedChatBoxWorkflow] = useState<CreateWorkflow | null>(null)
  const pageScrollRef = useRef<HTMLDivElement>(null)
  const chatBoxRef = useRef<HTMLDivElement>(null)
  const omniChatBoxRef = useRef<null | OmniChatBoxRef>(null)
  const floatingCtaFocusTimeoutRef = useRef<null | ReturnType<typeof setTimeout>>(null)
  const handledDeepLinkKeyRef = useRef<null | string>(null)
  const { handleUseCaseSelect, isUseCaseSwitchDisabled, selectedUseCaseKey } = useUseCaseSelect()
  const isCreateMode = mode === 'create'
  const createUseCaseFromQuery = searchParams?.get(CREATE_USE_CASE_QUERY_PARAM) ?? null
  const hasValidCreateUseCaseQuery = CREATE_USE_CASES.some(
    (useCase) => useCase.key === createUseCaseFromQuery,
  )
  // Sticky once the user taps a grid card. Combined with the query-param case below
  // to decide whether a use case has been chosen yet.
  const [hasTappedCreateUseCase, setHasTappedCreateUseCase] = useState(false)
  const hasChosenCreateUseCase = hasTappedCreateUseCase || hasValidCreateUseCaseQuery
  // Mobile-only: the use-case grid is the mobile create entry. On desktop the use
  // case is chosen via DashboardUseCaseButtons, so /create on desktop falls back to
  // the standard dashboard layout instead of the grid.
  const shouldShowCreateUseCaseGrid = isBelowMd && isCreateMode && !hasChosenCreateUseCase

  useEffect(() => {
    const el = pageScrollRef.current
    if (!el) {
      return
    }
    setDashboardTopBannerScrollContainer(el)
    return () => setDashboardTopBannerScrollContainer(null)
  }, [])

  const selectedUseCase = getCreateUseCase(selectedUseCaseKey)
  const selectedWorkflow = selectedUseCase.workflow
  const deepLinkTemplateId = searchParams?.get(QUICK_START_TEMPLATE_QUERY_KEY) ?? null
  const deepLinkTemplateSourceRaw = searchParams?.get(QUICK_START_TEMPLATE_SOURCE_QUERY_KEY) ?? null
  const workflowFromSource = getWorkflowFromQuickStartSource(deepLinkTemplateSourceRaw)
  const sourceFromQuery = isQuickStartTemplateSource(deepLinkTemplateSourceRaw)
    ? deepLinkTemplateSourceRaw
    : null
  const selectedSource = getQuickStartSourceFromWorkflow(selectedWorkflow)
  const { deepLinkTemplate } = useDeepLinkTemplate(deepLinkTemplateId)

  useEffect(() => {
    return () => {
      if (floatingCtaFocusTimeoutRef.current) {
        clearTimeout(floatingCtaFocusTimeoutRef.current)
        floatingCtaFocusTimeoutRef.current = null
      }
    }
  }, [])

  const [currentSettings, setCurrentSettings] = useState<null | OmniBoxSettings>(null)
  const attachments = useAtomValue(attachmentsAtom)
  const setAttachments = useSetAtom(attachmentsAtom)
  const handleCreateUseCaseCardSelect = useRefCallback((nextUseCaseKey: CreateUseCaseKey) => {
    handleUseCaseSelect(nextUseCaseKey)
    setHasTappedCreateUseCase(true)
  })

  // Re-tapping the mobile Create tab while already on /create cannot navigate
  // (same route), so it sets resetMobileCreateGridAtom instead. Consume it here
  // to clear the tap latch and bring the use-case grid back. useUseCaseSync
  // writes ?create=<key> on selection, so clear it too -- otherwise
  // hasValidCreateUseCaseQuery keeps the grid hidden.
  const setMobileCreateUseCaseGridVisible = useSetAtom(mobileCreateUseCaseGridVisibleAtom)
  const shouldResetCreateGrid = useAtomValue(resetMobileCreateGridAtom)
  const setShouldResetCreateGrid = useSetAtom(resetMobileCreateGridAtom)
  useEffect(() => {
    if (shouldResetCreateGrid) {
      setHasTappedCreateUseCase(false)
      removeQuery([CREATE_USE_CASE_QUERY_PARAM], { mode: 'replace' })
      setShouldResetCreateGrid(false)
    }
  }, [removeQuery, shouldResetCreateGrid, setShouldResetCreateGrid])

  useEffect(() => {
    setMobileCreateUseCaseGridVisible(shouldShowCreateUseCaseGrid)
    return () => setMobileCreateUseCaseGridVisible(false)
  }, [shouldShowCreateUseCaseGrid, setMobileCreateUseCaseGridVisible])

  // On chatBoxState mount and use-case switch: reset the composer to the use
  // case's default prompt. React guarantees child effects (OmniChatBox) commit
  // before parent effects, so the composer state is ready when this runs.
  useEffect(() => {
    if (!chatBoxState) {
      return
    }
    setAttachments([])
    syncChatBoxMessage(chatBoxState, selectedUseCase.defaultPrompt ?? '')
  }, [chatBoxState, selectedUseCaseKey, selectedUseCase.defaultPrompt, setAttachments])

  useUseCaseSync({ searchParams, selectedUseCaseKey, setQuery })

  useEffect(() => {
    setQuickStartTemplatesAtom(templatesBySource[selectedSource])
  }, [selectedSource, setQuickStartTemplatesAtom, templatesBySource])

  useEffect(() => {
    if (deepLinkTemplateId) {
      return
    }

    handledDeepLinkKeyRef.current = null
    setDeepLinkTemplate(null)
  }, [deepLinkTemplateId, setDeepLinkTemplate])

  useEffect(() => {
    if (!deepLinkTemplateId) {
      return
    }

    const deepLinkKey = `${deepLinkTemplateId}:${deepLinkTemplateSourceRaw ?? ''}`
    if (handledDeepLinkKeyRef.current === deepLinkKey) {
      return
    }
    handledDeepLinkKeyRef.current = deepLinkKey

    const initialSource = sourceFromQuery ?? selectedSource
    const initialTemplates = templatesBySource[initialSource]
    const initialIndex = initialTemplates.findIndex((item) => item.projectId === deepLinkTemplateId)

    setTemplateDialogState({
      initialIndex: initialIndex === -1 ? 0 : initialIndex,
      open: true,
      templates: initialTemplates,
    })
    setQuickStartTemplatesAtom(initialTemplates)
    setDeepLinkTemplate(null)

    if (workflowFromSource) {
      const targetUseCaseKey = getDefaultUseCaseKeyForWorkflow(workflowFromSource)
      setSelectedUseCaseKey((prev) => (prev === targetUseCaseKey ? prev : targetUseCaseKey))
    }
  }, [
    deepLinkTemplateId,
    deepLinkTemplateSourceRaw,
    selectedSource,
    setDeepLinkTemplate,
    setQuickStartTemplatesAtom,
    setSelectedUseCaseKey,
    setTemplateDialogState,
    sourceFromQuery,
    templatesBySource,
    workflowFromSource,
  ])

  useEffect(() => {
    if (!deepLinkTemplateId || !deepLinkTemplate) {
      return
    }

    setDeepLinkTemplate(deepLinkTemplate)

    const workflowFromTemplate = getWorkflowFromQuickStartSource(
      getQuickStartSourceFromTemplate(deepLinkTemplate),
    )
    if (!workflowFromTemplate) {
      return
    }
    const targetUseCaseKey = getDefaultUseCaseKeyForWorkflow(workflowFromTemplate)
    setSelectedUseCaseKey((prev) => (prev === targetUseCaseKey ? prev : targetUseCaseKey))
  }, [deepLinkTemplate, deepLinkTemplateId, setDeepLinkTemplate, setSelectedUseCaseKey])

  useEffect(() => {
    if (!deepLinkTemplateId || !templateDialogState.open) {
      return
    }

    const sourceFromTemplate = deepLinkTemplate
      ? getQuickStartSourceFromTemplate(deepLinkTemplate)
      : null
    const located = resolveDeepLinkTemplateLocation(deepLinkTemplateId, templatesBySource, [
      sourceFromQuery,
      sourceFromTemplate,
      selectedSource,
    ])
    if (!located) {
      return
    }
    const { index: preferredIndex, templates: preferredTemplates } = located

    setTemplateDialogState((prev) => {
      if (!prev.open) {
        return prev
      }
      if (prev.templates === preferredTemplates && prev.initialIndex === preferredIndex) {
        return prev
      }
      return {
        ...prev,
        initialIndex: preferredIndex,
        templates: preferredTemplates,
      }
    })
    setQuickStartTemplatesAtom(preferredTemplates)
  }, [
    deepLinkTemplate,
    deepLinkTemplateId,
    selectedSource,
    setQuickStartTemplatesAtom,
    setTemplateDialogState,
    sourceFromQuery,
    templateDialogState.open,
    templatesBySource,
  ])

  const handleDialogClose = useRefCallback(() => {
    setDeepLinkTemplate(null)
    setTemplateDialogState({
      initialIndex: 0,
      open: false,
      templates: [],
    })
    removeQuery([...QUICK_START_DEEP_LINK_QUERY_KEYS], { mode: 'replace' })
  })

  const { queueTransfer } = useTransfers({
    chatBoxState,
    chatBoxRef,
    isMobileLayout: isBelowMd,
    mountedChatBoxWorkflow,
    onTransferQueued: handleDialogClose,
    omniChatBoxRef,
    searchParams,
    selectedWorkflow,
  })
  const demoDialog = useDashboardTemplateDialogActions({
    closeDialog: handleDialogClose,
    composerRef: chatBoxRef,
    onDefaultRecreate: (template, payload) => {
      queueTransfer({
        payload,
        type: 'recreate',
        workflow: getWorkflowFromQuickStartTemplate(template),
      })
    },
    onDefaultTemplateChange: (template) => {
      setQuery(
        {
          [QUICK_START_TEMPLATE_QUERY_KEY]: template.projectId,
          [QUICK_START_TEMPLATE_SOURCE_QUERY_KEY]: getQuickStartSourceFromTemplate(template),
        },
        { mode: 'replace' },
      )
    },
  })

  // Mobile: when a Remix/Copy Style card button sets an atom, convert it to a URL
  // transfer and navigate to /create so MobileCreateSheet can apply the payload.
  // useTransfers skips its own atom watchers when isMobileLayout is true, so
  // there's no double-processing.
  const [atomPendingRemix, setAtomPendingRemix] = useAtom(pendingRemixAtom)
  const [atomPendingStyle, setAtomPendingStyle] = useAtom(pendingUseThisStyleAtom)

  useEffect(() => {
    if (!isBelowMd || isCreateMode || !atomPendingRemix) {
      return
    }
    const query = setUrlTransfer({ [REMIX_QUERY_KEY]: atomPendingRemix })
    setAtomPendingRemix(null)
    router.push(
      `/create?${new URLSearchParams({ [CREATE_USE_CASE_QUERY_PARAM]: 'script-to-video', ...query }).toString()}`,
    )
  }, [atomPendingRemix, isBelowMd, isCreateMode, router, setAtomPendingRemix])

  useEffect(() => {
    if (!isBelowMd || isCreateMode || !atomPendingStyle) {
      return
    }
    const query = setUrlTransfer({ [USE_THIS_STYLE_QUERY_KEY]: atomPendingStyle })
    setAtomPendingStyle(null)
    router.push(
      `/create?${new URLSearchParams({ [CREATE_USE_CASE_QUERY_PARAM]: 'script-to-video', ...query }).toString()}`,
    )
  }, [atomPendingStyle, isBelowMd, isCreateMode, router, setAtomPendingStyle])

  usePageEffects({ selectedWorkflow })

  // Marketing deep link `?select-video-model=<id>` -- consumed and
  // stripped (the video model selector is off, so no id can be selected).
  useVideoModelDeepLink({ removeQuery, searchParams })

  useChatBoxVisibility({
    chatBoxRef,
    scrollContainerRef: undefined,
    selectedWorkflow,
  })
  // On mobile the OmniChatBox is never rendered, so use scroll position as the
  // visibility proxy instead (same semantic: button appears once the top of the
  // page is off-screen).
  const shouldShowFloatingCreateButton = !isCreateMode && (isBelowMd || !isChatBoxVisible)

  // Warm the /create route while on the dashboard so tapping the CTA doesn't pay
  // the RSC round-trip on a cold navigation.
  useEffect(() => {
    if (isBelowMd && !isCreateMode) {
      router.prefetch('/create')
    }
  }, [isBelowMd, isCreateMode, router])

  const handleFloatingCtaClick = useRefCallback(() => {
    if (isBelowMd) {
      // Skip the CreateUseCaseGrid by pre-selecting the current use case, which sets
      // hasValidCreateUseCaseQuery=true and opens MobileCreateSheet directly.
      router.push(`/create?${CREATE_USE_CASE_QUERY_PARAM}=${selectedUseCaseKey}`)
      return
    }
    chatBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (floatingCtaFocusTimeoutRef.current) {
      clearTimeout(floatingCtaFocusTimeoutRef.current)
    }
    floatingCtaFocusTimeoutRef.current = setTimeout(() => {
      const editable = chatBoxRef.current?.querySelector(
        '[contenteditable="true"]',
      ) as HTMLElement | null
      editable?.focus()
    }, 500)
  })

  // "Try an example" from the first-video prompt (no agent can run Easy): the idea goes in the
  // composer, focused like the floating "Describe your video idea" button does.
  const handleTryExample = useRefCallback((idea: string) => {
    if (chatBoxState) {
      syncChatBoxMessage(chatBoxState, idea)
    }
    handleFloatingCtaClick()
  })

  const handleTemplateClick = useRefCallback(
    (template: QuickStartTemplate, index: number, clickedTemplates?: QuickStartTemplate[]) => {
      const source = getQuickStartSourceFromTemplate(template)

      if (clickedTemplates) {
        setTemplatesBySource((prev) => ({
          ...prev,
          [source]: clickedTemplates,
        }))
        setTemplateDialogState({
          initialIndex: index,
          open: true,
          templates: clickedTemplates,
        })
        setQuickStartTemplatesAtom(clickedTemplates)
        handledDeepLinkKeyRef.current = `${template.projectId}:${source}`
      }

      setQuery({
        [QUICK_START_TEMPLATE_QUERY_KEY]: template.projectId,
        [QUICK_START_TEMPLATE_SOURCE_QUERY_KEY]: source,
      })
    },
  )

  const handleOmniChatBoxRef = useRefCallback((instance: null | OmniChatBoxRef) => {
    if (!instance) {
      omniChatBoxRef.current = null
      setChatBoxState(undefined)
      setMountedChatBoxWorkflow(null)
      return
    }

    omniChatBoxRef.current = instance
    setChatBoxState(instance.getState())
    setMountedChatBoxWorkflow(selectedWorkflow)
  })

  const handleWorkflowTemplatesChange = useRefCallback(
    (source: QuickStartTemplateSource, templates: QuickStartTemplate[]) => {
      setTemplatesBySource((prev) => {
        if (prev[source] === templates) {
          return prev
        }

        return { ...prev, [source]: templates }
      })
    },
  )

  // One-time Song to Video onboarding poster. Web only (the
  // full-screen poster reads poorly on mobile), shown the first time the song-to-video view is entered.
  const s2vOnboardingPoster = useSongToVideoOnboardingPoster({
    enabled: !isBelowMd && selectedUseCaseKey === 'song-to-video',
  })

  const highlightTitle = selectedUseCase.dashboardV2Title
  return (
    <div
      className="flex flex-col bg-background bg-cover bg-center transition-colors duration-200 md:h-screen"
      ref={pageScrollRef}
    >
      <div className="flex flex-col md:flex-row">
        <AppSidebar />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className={cn('flex flex-col flex-1 min-w-0 z-10 md:pt-15 md:px-12')}>
            {shouldShowCreateUseCaseGrid ? (
              <div className="w-full max-w-[430px] md:max-w-content">
                <CreateUseCaseGrid
                  disabled={isUseCaseSwitchDisabled}
                  onClose={() => router.push('/home')}
                  onSelect={handleCreateUseCaseCardSelect}
                />
              </div>
            ) : (
              <div
                className={cn(
                  // md:pt-8 keeps the breathing room between the top banner
                  // and the hero title.
                  'flex flex-col items-center gap-4 md:pt-8',
                  isCreateMode &&
                    'flex-1 items-stretch justify-start px-2 pt-3 pb-[var(--mobile-bottom-bar-content-height)] md:flex-none md:items-center md:justify-start md:p-0',
                )}
              >
                {!isCreateMode && (
                  <HomeSetupCard
                    className="w-full max-w-content px-6 md:px-0"
                    onBusyChange={setFirstVideoBusy}
                    onTryExample={handleTryExample}
                  />
                )}

                {!isBelowMd && (
                  <DashboardIntro highlightTitle={highlightTitle} isCreateMode={isCreateMode} />
                )}

                {!isBelowMd && (
                  <div
                    className={cn('w-full max-w-content', isCreateMode ? 'px-0' : 'px-6 md:px-0')}
                    ref={chatBoxRef}
                  >
                    <OmniChatBox
                      autoFocus={false}
                      className={selectedWorkflow === 'story-mode' ? 'w-full' : 'p-2 w-full'}
                      key={selectedUseCaseKey}
                      onSettingsChange={setCurrentSettings}
                      pageType={selectedWorkflow}
                      placeholder={selectedUseCase.placeholderText}
                      ref={handleOmniChatBoxRef}
                      // Drives use-case-specific omnibox states; without it the
                      // song-to-video upload card never renders.
                      useCaseKey={selectedUseCaseKey}
                    />
                  </div>
                )}

                {!isBelowMd && !isFocusedCreateUseCaseKey(selectedUseCaseKey) && (
                  <div className="w-full overflow-x-auto scrollbar-hide md:w-auto">
                    <div className="w-max px-6 pt-2 md:pl-0 md:pr-1">
                      <DashboardUseCaseButtons
                        disabled={isUseCaseSwitchDisabled}
                        onSelect={handleUseCaseSelect}
                        selectedUseCaseKey={selectedUseCaseKey}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mobile create sheet: slides up over the grid when a use case is selected.
              Breakpoint-gated so it never mounts alongside the desktop OmniChatBox
              (both bind the same omniChatBoxRef). */}
            {isBelowMd && isCreateMode && (
              <MobileCreateSheet
                currentSettings={currentSettings}
                disabled={isUseCaseSwitchDisabled}
                omniChatBoxRef={omniChatBoxRef}
                onChatBoxRef={handleOmniChatBoxRef}
                onClose={() => router.push('/home')}
                onSettingsChange={setCurrentSettings}
                onUseCaseSelect={handleUseCaseSelect}
                open={hasChosenCreateUseCase}
                pageType={selectedWorkflow}
                placeholder={selectedUseCase.placeholderText}
                selectedUseCaseKey={selectedUseCaseKey}
              />
            )}

            {!isCreateMode && (
              <div className="@container flex flex-col gap-6 w-full px-4 pt-4 pb-10 md:px-0 md:py-16">
                {mountedWorkflows['story-mode'] && (
                  <StoryModeTemplateList
                    onStoryTemplateClick={handleTemplateClick}
                    onWorkflowTemplatesChange={handleWorkflowTemplatesChange}
                    selectedUseCaseKey={selectedUseCaseKey}
                    visible={selectedWorkflow === 'story-mode'}
                  />
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* First-time Song to Video onboarding poster. "Get started"
          is the only dismiss affordance per design. */}
      <SongToVideoOnboardingPoster
        onGetStarted={() => {
          s2vOnboardingPoster.dismiss()
        }}
        open={s2vOnboardingPoster.isOpen}
      />

      <QuickStartTemplateDialog
        initialIndex={templateDialogState.initialIndex}
        onClose={handleDialogClose}
        onRecreate={demoDialog.handleTemplateRecreate}
        onTemplateChange={demoDialog.handleTemplateDialogChange}
        open={templateDialogState.open}
        templates={templateDialogState.templates}
      />

      {!isCreateMode && (
        <EnterPromptCta
          onFocus={handleFloatingCtaClick}
          text="Describe your video idea"
          visible={shouldShowFloatingCreateButton}
        />
      )}

      {/* Story Mode onboarding tour for first-time users on Dashboard V2.
          Excluded in song-to-video mode, which has its own 2-step tour below.
          Suppressed in create mode (the mobile /create route). */}
      {!isCreateMode &&
        !firstVideoBusy &&
        selectedWorkflow === 'story-mode' &&
        selectedUseCaseKey !== 'song-to-video' && (
          <OnboardingTour announcementId="story-mode-onboarding-tour" />
        )}

      {/* Song to Video 2-step tour (assets + style). Mounted only after
          the song upload lands, because its anchor elements (the Style/Assets
          chips) only exist once the upload card swaps to the standard panel. */}
      {!isCreateMode &&
        selectedUseCaseKey === 'song-to-video' &&
        attachments.some(isStoryModeAudioAttachment) && <SongToVideoOnboardingTour />}
    </div>
  )
}

export default DashboardV2Page
