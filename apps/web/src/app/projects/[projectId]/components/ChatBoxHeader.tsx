'use client'

import { PROJECT_STAGE } from '@shared/types/enums/project'
import { Button, Tooltip } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useRouter } from 'next/navigation'
import { memo, useMemo, useState } from 'react'

import { isEditorModeAtom } from '@/atom/sceneCanvas'
import { Question, SemiArrowLeft } from '@/components/icons/core'
import { useProjectAtom } from '@/hooks/useProjects'
import { useIsMobile } from '@/util/browserUtils'
import { goBackSafe } from '@/util/go-back-safe'

import { EditorHistoryToolbar } from '../editor/components/EditorHistoryToolbar'
import { useEditorSettings } from '../editor/hooks/useEditorSettings'

import { ModeTabSwitcher } from './ModeTabSwitcher'
import ProjectShareButton from './ProjectShareButton'

interface ChatBoxHeaderProps {
  projectId: null | string
  shareMode?: boolean
}

const ChatBoxHeader: React.FC<ChatBoxHeaderProps> = ({ projectId, shareMode }) => {
  const router = useRouter()
  const { projectInfo } = useProjectAtom()
  const isEditMode = useAtomValue(isEditorModeAtom)
  const isMobile = useIsMobile()
  const { enableVideoEditor } = useEditorSettings()

  const isProjectReady = useMemo(
    () =>
      (projectInfo?.stage === PROJECT_STAGE.FINISHED ||
        projectInfo?.stage === PROJECT_STAGE.EDITOR) &&
      !!projectInfo?.resultVideo,
    [projectInfo?.stage, projectInfo?.resultVideo],
  )
  const projectPromptLabel = useMemo(
    () => projectInfo?.name || projectInfo?.initPrompt || '',
    [projectInfo?.name, projectInfo?.initPrompt],
  )

  const [activePopover, setActivePopover] = useState<'info' | null>(null)

  return (
    <header className="relative flex h-12 shrink-0 flex-row pl-2 pr-4 py-2 border-b border-tertiary">
      <nav className="flex flex-1 min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-row items-center gap-2">
          <Button
            aria-label="Go back"
            className="hover:bg-fill-hover size-8 rounded-sm bg-transparent"
            onClick={() => goBackSafe(router, '/projects')}
            size="icon"
          >
            <SemiArrowLeft className="text-primary size-4.5" />
          </Button>
          <div className="min-w-0 h-8 rounded-[10px] px-2.5 inline-flex items-center">
            <span className="text-primary truncate text-sm font-medium leading-4">
              {projectPromptLabel}
            </span>
          </div>
          {!isMobile && enableVideoEditor && <ModeTabSwitcher />}
        </div>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        {isEditMode && !isMobile && (
          <>
            <EditorHistoryToolbar />
            <div className="h-4 w-px bg-white/10" />
          </>
        )}
        <div className="flex items-center gap-1">
          {!isMobile && (
            <Tooltip
              align="center"
              className="bg-overlay animate-dropdown-slide-down text-primary rounded-md border-none px-2.5 py-2 backdrop-blur-xl"
              content={
                <div className="text-primary w-[280px] font-medium">
                  Information assets are from the Internet, not provided by ReelMakeEasy.
                </div>
              }
              onOpenChange={(open) => setActivePopover(open ? 'info' : null)}
              open={activePopover === 'info'}
              side="bottom"
              sideOffset={8}
            >
              <Button
                className="hover:bg-fill-hover flex size-8 items-center justify-center rounded-sm bg-transparent"
                size="icon"
              >
                <Question className="text-primary size-4.5" />
              </Button>
            </Tooltip>
          )}
          {!shareMode && (
            <ProjectShareButton isProjectReady={isProjectReady} projectId={projectId} />
          )}
        </div>
      </div>
    </header>
  )
}

export default memo(ChatBoxHeader)
