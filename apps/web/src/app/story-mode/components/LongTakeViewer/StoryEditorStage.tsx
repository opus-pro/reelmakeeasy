'use client'

import type { ReactNode } from 'react'

import { ProjectThumbnailStrip } from '@/components/ProjectThumbnailStrip'

import type { SiblingProject } from './sibling-types'

interface StoryEditorStageProps {
  editorCenter: ReactNode
  editorPanel: ReactNode
  onSelectSibling?: (projectId: string) => void
  projectId: string
  siblings?: SiblingProject[]
  siblingStripVisible: boolean
}

/**
 * Editor-mode stage: the editor center, the detail panel to its right, and the
 * sibling thumbnail strip.
 */
export function StoryEditorStage({
  editorCenter,
  editorPanel,
  onSelectSibling,
  projectId,
  siblings,
  siblingStripVisible,
}: StoryEditorStageProps) {
  return (
    <div className="relative z-10 flex size-full min-h-0 min-w-0 flex-row items-stretch justify-center gap-6 px-5 py-6">
      {editorCenter}
      <div className="shrink-0">
        <div className="flex h-full items-stretch">
          <div className="w-6 shrink-0" />
          <div className="relative h-full w-88 shrink-0 overflow-visible">{editorPanel}</div>
          {siblingStripVisible && siblings && onSelectSibling && (
            <>
              <div className="w-6 shrink-0" />
              <aside className="flex shrink-0 items-start justify-center">
                <ProjectThumbnailStrip
                  data-testid="sibling-strip-pane"
                  items={siblings}
                  onSelect={onSelectSibling}
                  selectedId={projectId}
                />
              </aside>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
