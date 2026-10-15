import { computeOptimalHorizontalLayout } from '@/components/project-card-grid/horizontal-layout-math'

export type CardAspectRatio = '1:1' | '9:16' | '16:9'

export type HorizontalRow<T extends { aspectRatio?: CardAspectRatio }> = {
  height: number
  isJustified: boolean
  items: HorizontalRowItem<T>[]
}

export type HorizontalRowHeight = {
  max?: number
  min?: number
  target?: number
}

export type HorizontalRowItem<T extends { aspectRatio?: CardAspectRatio }> = {
  aspect: number
  item: T
  originalIndex: number
  width: number
}

export type NormalizedHorizontalRowHeight = {
  max: number
  min: number
  target: number
}

export const DEFAULT_HORIZONTAL_ROW_HEIGHT: NormalizedHorizontalRowHeight = {
  max: 380,
  min: 300,
  target: 340,
}

export const PROJECT_CARD_GRID_GAP_PX = 12

const RATIO_WIDTH_WEIGHT: Record<CardAspectRatio, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '16:9': 16 / 9,
}

const itemAspectWeightCache = new WeakMap<readonly unknown[], readonly number[]>()

export function distributeIntoHorizontalRows<T extends { aspectRatio?: CardAspectRatio }>(
  items: T[],
  containerWidth: number,
  rowHeight: NormalizedHorizontalRowHeight,
  gapPx = PROJECT_CARD_GRID_GAP_PX,
): HorizontalRow<T>[] {
  if (items.length === 0) {
    return []
  }

  const resolvedContainerWidth =
    Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0
  const resolvedGapPx = getPositiveNumber(gapPx, PROJECT_CARD_GRID_GAP_PX)
  const aspects = getAspectWeights(items)
  const computedRows = computeOptimalHorizontalLayout({
    aspects,
    containerWidth: resolvedContainerWidth,
    gapPx: resolvedGapPx,
    rowHeight: scaleRowHeightForContainer(rowHeight, resolvedContainerWidth),
  })

  return computedRows.map((row) => {
    const rowEntries = createRowEntries(items, aspects, row.start, row.endExclusive)
    return {
      height: row.height,
      isJustified: row.isJustified,
      items: createHorizontalRowItems(rowEntries, {
        containerWidth: resolvedContainerWidth,
        gapPx: resolvedGapPx,
        height: row.height,
        justify: row.isJustified,
      }),
    }
  })
}

export function normalizeHorizontalRowHeight(
  rowHeight?: HorizontalRowHeight,
): NormalizedHorizontalRowHeight {
  const min = getPositiveNumber(rowHeight?.min, DEFAULT_HORIZONTAL_ROW_HEIGHT.min)
  const max = getPositiveNumber(rowHeight?.max, DEFAULT_HORIZONTAL_ROW_HEIGHT.max)
  const [normalizedMin, normalizedMax] = min <= max ? [min, max] : [max, min]
  const rawTarget = getPositiveNumber(rowHeight?.target, DEFAULT_HORIZONTAL_ROW_HEIGHT.target)

  return {
    max: normalizedMax,
    min: normalizedMin,
    target: clamp(rawTarget, normalizedMin, normalizedMax),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// When containerWidth is narrower than rowHeight.max, scale the entire
// [min, max, target] range proportionally so the DP cost function sees
// a target that is actually achievable at the current container size.
function createHorizontalRowItems<T extends { aspectRatio?: CardAspectRatio }>(
  row: Array<{ aspect: number; item: T; originalIndex: number }>,
  options: {
    containerWidth: number
    gapPx: number
    height: number
    justify: boolean
  },
): HorizontalRowItem<T>[] {
  let usedWidth = 0
  const gapsWidth = options.gapPx * (row.length - 1)

  return row.map((entry, index) => {
    let width = options.height * entry.aspect

    if (options.justify && index === row.length - 1) {
      width = Math.max(1, options.containerWidth - gapsWidth - usedWidth)
    }

    usedWidth += width

    return {
      aspect: entry.aspect,
      item: entry.item,
      originalIndex: entry.originalIndex,
      width,
    }
  })
}

function createRowEntries<T extends { aspectRatio?: CardAspectRatio }>(
  items: readonly T[],
  aspects: readonly number[],
  start: number,
  endExclusive: number,
): Array<{ aspect: number; item: T; originalIndex: number }> {
  const entries: Array<{ aspect: number; item: T; originalIndex: number }> = []
  for (let index = start; index < endExclusive; index++) {
    entries.push({
      aspect: aspects[index] ?? getAspectRatioWidthWeight(items[index]?.aspectRatio),
      item: items[index] as T,
      originalIndex: index,
    })
  }
  return entries
}

function getAspectRatioWidthWeight(ratio: CardAspectRatio | undefined): number {
  return RATIO_WIDTH_WEIGHT[ratio ?? '9:16']
}

function getAspectWeights<T extends { aspectRatio?: CardAspectRatio }>(
  items: readonly T[],
): readonly number[] {
  const cached = itemAspectWeightCache.get(items)
  if (cached) {
    return cached
  }

  const weights = items.map((item) => getAspectRatioWidthWeight(item.aspectRatio))
  itemAspectWeightCache.set(items, weights)
  return weights
}

function getPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function scaleRowHeightForContainer(
  rowHeight: NormalizedHorizontalRowHeight,
  containerWidth: number,
): NormalizedHorizontalRowHeight {
  if (containerWidth <= 0 || containerWidth >= rowHeight.max) {
    return rowHeight
  }
  const scale = containerWidth / rowHeight.max
  const scaledMax = containerWidth
  const scaledMin = Math.min(rowHeight.min * scale, scaledMax)
  const scaledTarget = clamp(rowHeight.target * scale, scaledMin, scaledMax)
  return { max: scaledMax, min: scaledMin, target: scaledTarget }
}
