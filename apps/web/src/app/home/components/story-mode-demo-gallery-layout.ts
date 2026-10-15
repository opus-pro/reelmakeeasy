import type { QuickStartTemplate } from '@shared/types/assets/quick-start'

export type StoryModeDemoGalleryItem<TTemplate extends Pick<QuickStartTemplate, 'aspectRatio'>> = {
  item: TTemplate
  originalIndex: number
  width: number
}

export type StoryModeDemoGalleryRow<TTemplate extends Pick<QuickStartTemplate, 'aspectRatio'>> = {
  height: number
  isTrailingRow: boolean
  items: StoryModeDemoGalleryItem<TTemplate>[]
}

type BuildStoryModeDemoGalleryRowsOptions = {
  gap?: number
  maxRowHeight?: number
  targetTrailingRowHeight?: number
}

type CardAspectRatio = '1:1' | '9:16' | '16:9'

type StoryModeDemoGalleryEntry<TTemplate extends Pick<QuickStartTemplate, 'aspectRatio'>> = {
  aspectRatio: number
  item: TTemplate
  originalIndex: number
}

const DEFAULT_GAP_PX = 4
const DEFAULT_MAX_ROW_HEIGHT_PX = 560
const DEFAULT_TARGET_TRAILING_ROW_HEIGHT_PX = 480
const DEFAULT_ASPECT_RATIO = 9 / 16

export function buildStoryModeDemoGalleryRows<
  TTemplate extends Pick<QuickStartTemplate, 'aspectRatio'>,
>(
  items: readonly TTemplate[],
  containerWidth: number,
  {
    gap = DEFAULT_GAP_PX,
    maxRowHeight = DEFAULT_MAX_ROW_HEIGHT_PX,
    targetTrailingRowHeight = DEFAULT_TARGET_TRAILING_ROW_HEIGHT_PX,
  }: BuildStoryModeDemoGalleryRowsOptions = {},
): StoryModeDemoGalleryRow<TTemplate>[] {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || items.length === 0) {
    return []
  }

  const rows: StoryModeDemoGalleryRow<TTemplate>[] = []
  let currentRow: StoryModeDemoGalleryEntry<TTemplate>[] = []
  let aspectRatioSum = 0

  items.forEach((item, originalIndex) => {
    const nextEntry = {
      aspectRatio: storyModeCardAspectRatioToNumber(item.aspectRatio),
      item,
      originalIndex,
    }

    currentRow.push(nextEntry)
    aspectRatioSum += nextEntry.aspectRatio

    const gapsWidth = gap * (currentRow.length - 1)
    const fittedHeight = (containerWidth - gapsWidth) / aspectRatioSum

    if (fittedHeight <= maxRowHeight) {
      rows.push(createRow(currentRow, fittedHeight, false))
      currentRow = []
      aspectRatioSum = 0
    }
  })

  if (currentRow.length > 0) {
    const gapsWidth = gap * (currentRow.length - 1)
    const fittedHeight = (containerWidth - gapsWidth) / aspectRatioSum
    rows.push(createRow(currentRow, Math.min(targetTrailingRowHeight, fittedHeight), true))
  }

  return rows
}

export function storyModeCardAspectRatioToNumber(aspectRatio?: CardAspectRatio): number {
  switch (aspectRatio) {
    case '1:1': {
      return 1
    }
    case '16:9': {
      return 16 / 9
    }
    default: {
      return DEFAULT_ASPECT_RATIO
    }
  }
}

function createRow<TTemplate extends Pick<QuickStartTemplate, 'aspectRatio'>>(
  entries: StoryModeDemoGalleryEntry<TTemplate>[],
  height: number,
  isTrailingRow: boolean,
): StoryModeDemoGalleryRow<TTemplate> {
  return {
    height,
    isTrailingRow,
    items: entries.map(({ aspectRatio, item, originalIndex }) => ({
      item,
      originalIndex,
      width: height * aspectRatio,
    })),
  }
}
