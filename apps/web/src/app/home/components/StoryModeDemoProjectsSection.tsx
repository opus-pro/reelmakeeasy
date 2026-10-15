'use client'

import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useMemo } from 'react'

import type { CreateUseCaseKey } from '@/constants/create-use-cases'
import { DEMO_GALLERY_MAX_RENDERED, demoMatchesSelectedUseCase } from '@/util/demo-input-type'

import { StoryModeDemoProjectsGallery } from './StoryModeDemoProjectsGallery'

type StoryModeDemoProjectsSectionProps = {
  onTemplateClick: (
    template: QuickStartTemplate,
    index: number,
    visibleTemplates: QuickStartTemplate[],
  ) => void
  selectedUseCaseKey?: CreateUseCaseKey
  templates: QuickStartTemplate[]
}

export function StoryModeDemoProjectsSection({
  onTemplateClick,
  selectedUseCaseKey,
  templates,
}: StoryModeDemoProjectsSectionProps) {
  const visibleTemplates = useMemo(() => {
    const useCaseKey = selectedUseCaseKey ?? 'script-to-video'

    // Every view renders its full matching list, bounded only by the
    // DEMO_GALLERY_MAX_RENDERED backstop, which is set to the most demos the
    // fetch layer can ever deliver. The previous 33 was not a render budget:
    // an earlier change cut a fetch PAGE SIZE from 50 to 33 back when the gallery fetched
    // one page, and a later refactor reused that constant as a slice. With no
    // "show more" in the gallery, every activated demo past the 33rd became
    // unreachable. Read the constraint doc before reintroducing a smaller cap.
    return templates
      .filter((template) => demoMatchesSelectedUseCase(template.inputType, useCaseKey))
      .slice(0, DEMO_GALLERY_MAX_RENDERED)
  }, [selectedUseCaseKey, templates])

  return (
    <div className="w-full">
      <div className="flex w-full flex-col">
        {visibleTemplates.length > 0 ? (
          <StoryModeDemoProjectsGallery
            onTemplateClick={(template, index) =>
              onTemplateClick(template, index, visibleTemplates)
            }
            showInputTypeBadge={false}
            templates={visibleTemplates}
          />
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center text-sm font-medium text-secondary">
            No demo videos yet for this use case.
          </div>
        )}
      </div>
    </div>
  )
}
