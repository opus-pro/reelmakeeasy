'use client'

import { Button, Tooltip } from '@shared/ui'
import { memo, useRef, useState } from 'react'

import { Export } from '@/components/icons/core'
import { ProjectSharePanel } from '@/components/ProjectSharePanel'
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick'
import { useProjectShareControls } from '@/hooks/useProjectShareControls'

interface ProjectShareButtonProps {
  isProjectReady: boolean
  projectId: null | string
}

const SHARE_PANEL_SELECTORS = ['[data-share-panel]'] as const

const ProjectShareButton: React.FC<ProjectShareButtonProps> = ({ isProjectReady, projectId }) => {
  const [isShareOpen, setIsShareOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const { copyShareLink, displayLink, isCopied, isPublic, sharedProjectId, toggleAccess } =
    useProjectShareControls(projectId)

  useDismissOnOutsideClick({
    enabled: isShareOpen,
    ignoreRefs: [triggerRef],
    ignoreSelectors: SHARE_PANEL_SELECTORS,
    onDismiss: () => setIsShareOpen(false),
  })

  if (!isProjectReady) {
    return (
      <Tooltip
        align="center"
        className="bg-overlay animate-dropdown-slide-down text-primary rounded-md border-none px-2.5 py-2 backdrop-blur-xl"
        content="Share link when the video is ready"
        side="bottom"
        sideOffset={8}
      >
        <Button
          className="size-8 flex items-center justify-center bg-transparent rounded-sm hover:bg-fill-hover"
          size="icon"
        >
          <Export className="size-4.5 text-primary" />
        </Button>
      </Tooltip>
    )
  }

  return (
    <Tooltip
      align="center"
      className="bg-transparent border-none p-0 shadow-none"
      collisionPadding={{ right: 18 }}
      content={
        <ProjectSharePanel
          displayLink={displayLink}
          isCopied={isCopied}
          isPublic={isPublic}
          onCopyLink={() => {
            void copyShareLink()
          }}
          onSelectPrivate={() => {
            void toggleAccess(false)
          }}
          onSelectPublic={() => {
            void toggleAccess(true)
          }}
        />
      }
      open={isShareOpen}
      side="bottom"
      sideOffset={8}
      trigger="click"
    >
      <div className="inline-flex" ref={triggerRef}>
        <Tooltip
          align="center"
          className="border-none rounded-xs bg-[#444] inline-flex h-7 px-3 justify-center items-center gap-1 text-xs font-normal text-white whitespace-nowrap"
          content={isShareOpen ? undefined : 'Share project'}
          side="bottom"
          sideOffset={8}
        >
          <Button
            className="size-8 flex items-center justify-center bg-transparent rounded-sm hover:bg-fill-hover"
            onClick={() => {
              const willOpen = !isShareOpen
              setIsShareOpen(willOpen)
              if (willOpen && isPublic && sharedProjectId) {
                void copyShareLink()
              }
            }}
            size="icon"
          >
            <Export className="text-primary size-4.5" />
          </Button>
        </Tooltip>
      </div>
    </Tooltip>
  )
}

export default memo(ProjectShareButton)
