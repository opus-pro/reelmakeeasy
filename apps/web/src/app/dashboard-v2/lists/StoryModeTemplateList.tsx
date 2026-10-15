'use client'

import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useEffect } from 'react'

import { StoryModeDemoProjectsSection } from '@/app/home/components/StoryModeDemoProjectsSection'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'
import { useStoryModeTemplates } from '@/hooks/useStoryModeTemplates'
import { FILTERABLE_DEMO_PAGE_SIZE } from '@/util/demo-input-type'

interface StoryModeTemplateListProps {
  onStoryTemplateClick: (
    template: QuickStartTemplate,
    index: number,
    templates: QuickStartTemplate[],
  ) => void
  onWorkflowTemplatesChange: (workflow: 'story-mode', templates: QuickStartTemplate[]) => void
  selectedUseCaseKey: CreateUseCaseKey
  visible: boolean
}

export function StoryModeTemplateList({
  onStoryTemplateClick,
  onWorkflowTemplatesChange,
  selectedUseCaseKey,
  visible,
}: StoryModeTemplateListProps) {
  const { templates } = useStoryModeTemplates(FILTERABLE_DEMO_PAGE_SIZE)

  // Publish the list the gallery actually renders, so a pasted link resolves
  // against the same carousel the user saw.
  useEffect(() => {
    onWorkflowTemplatesChange('story-mode', templates)
  }, [templates, onWorkflowTemplatesChange])

  // No demos (none ship by default, or they haven't loaded yet): no gallery at all.
  if (templates.length === 0) {
    return null
  }

  return (
    <>
      {visible && (
        <h2 className="text-center font-semibold leading-tight tracking-[-0.36px]">
          {/* Fades into grey so the gallery below stays the focus. */}
          <span
            className="min-w-0 bg-clip-text text-[clamp(1.10rem,3.2cqw,1.35rem)] text-transparent"
            style={{
              backgroundImage: 'linear-gradient(#fff, rgb(255 255 255 / 0.65) 75%)',
            }}
          >
            Get inspired. Then make it yours.
          </span>
        </h2>
      )}
      <div className={visible ? 'w-full' : 'h-0 overflow-hidden'}>
        <StoryModeDemoProjectsSection
          onTemplateClick={(template, index, visibleTemplates) =>
            onStoryTemplateClick(template, index, visibleTemplates)
          }
          selectedUseCaseKey={selectedUseCaseKey}
          templates={templates}
        />
      </div>
    </>
  )
}
