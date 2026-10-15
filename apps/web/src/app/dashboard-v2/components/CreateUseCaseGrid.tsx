'use client'

import { Button } from '@shared/ui'

import { CrossSmall } from '@/components/icons/core'
import { MobileHeaderIcon } from '@/components/projects-v2/MobileHeaderIcon'
import { CREATE_USE_CASES, type CreateUseCaseKey } from '@/constants/create-use-cases'

// The ordered use cases actually rendered in the grid (those with a card video).
export const GRID_USE_CASES = CREATE_USE_CASES.filter((useCase) => useCase.cardVideoUrl)

interface CreateUseCaseGridProps {
  disabled?: boolean
  onClose: () => void
  onSelect: (key: CreateUseCaseKey) => void
}

export function CreateUseCaseGrid({ disabled = false, onClose, onSelect }: CreateUseCaseGridProps) {
  return (
    <section
      className="flex flex-col w-full max-h-dvh gap-4 p-4 pb-0 md:pb-4 overflow-hidden md:h-auto rounded-3xl bg-panel"
      data-testid="create-use-case-grid"
    >
      <header className="flex shrink-0 items-center justify-between">
        <h1 className="text-lg font-medium leading-5 text-primary">Create</h1>
        <MobileHeaderIcon ariaLabel="Close" Icon={CrossSmall} onClick={onClose} />
      </header>
      <div className="flex flex-wrap flex-1 overflow-y-scroll gap-2.5 pb-4 scrollbar-hide">
        {GRID_USE_CASES.map((useCase) => (
          <CreateUseCaseCard
            disabled={disabled}
            key={useCase.key}
            onSelect={onSelect}
            useCase={useCase}
          />
        ))}
      </div>
    </section>
  )
}

const CARD_CLASS_NAME =
  'flex w-[calc(50%-5px)] shrink-0 flex-col items-stretch justify-start gap-2.5 overflow-hidden rounded-2xl bg-white/10 p-3 text-left opacity-100 whitespace-normal transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50'

const CARD_THUMBNAIL_CLASS_NAME =
  'w-full shrink-0 aspect-square overflow-hidden rounded-lg bg-fill-secondary'

const CARD_LABEL_CLASS_NAME =
  'w-full shrink-0 text-base font-semibold leading-[21.8px] tracking-normal text-primary'

function CreateUseCaseCard({
  disabled,
  onSelect,
  useCase,
}: {
  disabled: boolean
  onSelect: (key: CreateUseCaseKey) => void
  useCase: (typeof CREATE_USE_CASES)[number]
}) {
  return (
    <Button
      className={CARD_CLASS_NAME}
      disabled={disabled}
      onClick={() => onSelect(useCase.key)}
      type="button"
      variant="base"
    >
      <div className={CARD_THUMBNAIL_CLASS_NAME}>
        <video
          aria-hidden="true"
          autoPlay
          className="block size-full object-cover"
          loop
          muted
          playsInline
          preload="metadata"
          src={useCase.cardVideoUrl}
        />
      </div>
      <div className={CARD_LABEL_CLASS_NAME}>{useCase.dashboardV2SidebarLabel}</div>
    </Button>
  )
}
