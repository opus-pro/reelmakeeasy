'use client'

import { Button, cn } from '@shared/ui'
import { useAtom } from 'jotai'
import React, { useEffect, useState } from 'react'

import { isEditorModeAtom } from '@/atom/sceneCanvas'
import { useLegacyAnnouncementPreview } from '@/components/announcements/useLegacyAnnouncementPreview'
import { Cross } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'

const ANNOUNCEMENT_ID = 'editor-mode-tutorial'

export const ModeTabSwitcher = () => {
  const [isEditorMode, setIsEditorMode] = useAtom(isEditorModeAtom)
  const [showTutorial, setShowTutorial] = useState(false)
  const { forced, suppressed } = useLegacyAnnouncementPreview(ANNOUNCEMENT_ID)

  // Show tutorial on mount if not seen before
  useEffect(() => {
    if (forced) {
      setShowTutorial(true)
      return
    }
    if (suppressed) {
      setShowTutorial(false)
      return
    }
    setShowTutorial(localStorage.getItem('reelmakeeasy:editor-mode-tutorial') === null)
  }, [forced, suppressed])

  const handleCloseTutorial = useRefCallback(() => {
    setShowTutorial(false)
    if (!forced) {
      localStorage.setItem('reelmakeeasy:editor-mode-tutorial', 'true')
    }
  })

  const handleModeClick = useRefCallback((mode: 'editor' | 'preview') => {
    setIsEditorMode(mode === 'editor')
  })

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <Button
          className={cn(
            'h-8 min-w-[38px] rounded-sm px-2.5 text-sm font-medium hover:bg-fill-hover hover:text-primary transition-all duration-200',
            isEditorMode ? 'text-primary bg-transparent' : 'text-primary bg-fill-secondary',
          )}
          onClick={() => handleModeClick('preview')}
          variant="ghost"
        >
          <span className="flex items-center">
            <span
              className={cn(
                'h-2 rounded-full bg-accent-green transition-all duration-200 origin-center',
                isEditorMode ? 'w-0 mr-0 scale-0 opacity-0' : 'w-2 mr-2 scale-100 opacity-100',
              )}
            />
            Chat
          </span>
        </Button>
        <Button
          className={cn(
            'h-8 min-w-[38px] rounded-sm px-2.5 text-sm font-medium hover:bg-fill-hover hover:text-primary transition-all duration-200',
            isEditorMode ? 'text-primary bg-fill-secondary' : 'text-primary bg-transparent',
          )}
          onClick={() => handleModeClick('editor')}
          variant="ghost"
        >
          <span className="flex items-center">
            <span
              className={cn(
                'h-2 rounded-full bg-accent-green transition-all duration-200 origin-center',
                isEditorMode ? 'w-2 mr-2 scale-100 opacity-100' : 'w-0 mr-0 scale-0 opacity-0',
              )}
            />
            Editor
          </span>
        </Button>
        {/* Temporarily hidden - Unsaved changes indicator
        {hasLocalChanges && (
          <div className="flex items-center gap-2 ml-4">
            <span className="bg-warn size-1.5 rounded-full" />
            <span className="text-secondary text-sm whitespace-nowrap font-medium">
              Unsaved changes
            </span>
          </div>
        )}
        */}
      </div>

      {showTutorial && (
        <div className="absolute left-0 top-full z-50 mt-2">
          {/* Arrow */}
          <div className="border-x-6 border-b-6 border-b-menu ml-5 size-0 border-transparent" />
          {/* Content */}
          <div className="bg-menu w-80 rounded-lg p-2 shadow-lg">
            <div className="flex items-start gap-2">
              <p className="text-primary flex-1 text-sm leading-snug">
                Switch between Chat mode and Editor mode anytime.
              </p>
              <button
                className="hover:bg-fill-hover flex shrink-0 items-center justify-center rounded-full p-0.5 transition-colors"
                onClick={handleCloseTutorial}
              >
                <Cross className="text-secondary size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
