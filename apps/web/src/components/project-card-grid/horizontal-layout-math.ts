/**
 * Horizontal layout math for ProjectCardGrid.
 *
 * Why this module exists:
 * - Keep visual quality predictable for horizontal tiled cards.
 * - Respect public constraints (`min`, `max`, `target`) instead of using a single hardcoded row height.
 * - Preserve order and index semantics (we only partition, never reorder).
 * - Scale to large datasets without stalling the UI thread.
 *
 * High-level strategy:
 * - Convert cards into aspect weights.
 * - Use dynamic programming to choose row breaks that minimize a cost function.
 * - Use a different cost model for non-last rows vs the last row.
 * - Add an adaptive last-row justify rule when stretch variance is small.
 * - Cache results aggressively for repeated renders/resizes.
 */
export type HorizontalLayoutMathConstraints = {
  max: number
  min: number
  target: number
}

export type HorizontalLayoutMathInput = {
  aspects: readonly number[]
  containerWidth: number
  gapPx: number
  rowHeight: HorizontalLayoutMathConstraints
}

export type HorizontalLayoutMathRow = {
  endExclusive: number
  height: number
  isJustified: boolean
  start: number
}

const POSITIVE_INF = Number.POSITIVE_INFINITY
// Exact DP is O(n^2). Above this threshold we switch to bounded transitions.
const EXACT_TRANSITION_THRESHOLD = 1800
const ESTIMATION_WIDTH_CAP_PX = 1920
const MAX_BOUNDED_TRANSITIONS = 40
const MIN_BOUNDED_TRANSITIONS = 10
const TRANSITION_BUFFER = 14
const RESULT_CACHE_LIMIT_PER_ASPECTS = 24
const TRANSITION_CACHE_LIMIT_PER_ASPECTS = 12

const LAST_ROW_OVERFLOW_WEIGHT = 12
const LAST_ROW_UNDERFILL_WEIGHT = 0.2
const LAST_ROW_JUSTIFY_LAST_CARD_CORRECTION_MAX_RATIO = 0.15
const LAST_ROW_JUSTIFY_PREVIOUS_HEIGHT_MAX_DELTA = 0.08
const LAST_ROW_JUSTIFY_TARGET_MAX_DELTA = 0.12
const NON_LAST_TARGET_WEIGHT = 14
const NON_LAST_OUT_OF_BAND_WEIGHT = 60
const SINGLE_ITEM_ROW_PENALTY = 0.12

type BoundedTransitionConfig = {
  maxCount: number
}

type DynamicProgrammingState = {
  bestCost: Float64Array
  previousCut: Int32Array
  rowHeightByCut: Float64Array
  rowJustifiedByCut: Uint8Array
}

type RowEvaluationContext = {
  allowOutOfBandRows: boolean
  containerWidth: number
  gapPx: number
  itemCount: number
  prefixAspectSums: Float64Array
  rowHeight: HorizontalLayoutMathConstraints
}

const layoutResultCache = new WeakMap<
  readonly number[],
  Map<string, readonly HorizontalLayoutMathRow[]>
>()
const transitionConfigCache = new WeakMap<readonly number[], Map<string, BoundedTransitionConfig>>()

/**
 * Entry point used by layout-utils.ts.
 *
 * Notes:
 * - We normalize width/gap/row-height first so the math is stable.
 * - Result cache key is derived from normalized layout inputs.
 * - Cache is keyed by aspect-array identity (`WeakMap`) to avoid stale cross-data reuse.
 */
export function computeOptimalHorizontalLayout(
  input: HorizontalLayoutMathInput,
): HorizontalLayoutMathRow[] {
  const itemCount = input.aspects.length
  if (itemCount === 0) {
    return []
  }

  const resolvedContainerWidth = getPositiveNumber(input.containerWidth, 0)
  const resolvedGapPx = getPositiveNumber(input.gapPx, 0)
  const normalizedRowHeight = normalizeRowHeight(input.rowHeight)

  if (resolvedContainerWidth <= 0) {
    return [
      {
        endExclusive: itemCount,
        height: normalizedRowHeight.target,
        isJustified: false,
        start: 0,
      },
    ]
  }

  const cacheKey = [
    resolvedContainerWidth.toFixed(2),
    resolvedGapPx.toFixed(2),
    normalizedRowHeight.min.toFixed(2),
    normalizedRowHeight.max.toFixed(2),
    normalizedRowHeight.target.toFixed(2),
  ].join('|')

  const cachedRows = getCachedRows(input.aspects, cacheKey)
  if (cachedRows) {
    return cloneRows(cachedRows)
  }

  const dpInput = {
    aspects: input.aspects,
    containerWidth: resolvedContainerWidth,
    gapPx: resolvedGapPx,
    rowHeight: normalizedRowHeight,
  }
  // Strict pass first: it is the layout we want, and it is unchanged for every
  // input that has an in-band tiling. When it has none it degenerates into one
  // row holding the whole tail, which the anti-overflow clamp then squashes far
  // below `min` -- cards too small to read. Re-run with the band as cost only
  // and take that instead.
  const strictRows = runDynamicProgramming({ ...dpInput, allowOutOfBandRows: false })
  const rows = isSquashedBelowMin(strictRows, normalizedRowHeight)
    ? runDynamicProgramming({ ...dpInput, allowOutOfBandRows: true })
    : strictRows

  setCachedRows(input.aspects, cacheKey, rows)
  return cloneRows(rows)
}

function buildAdaptiveJustifiedLastRow(input: {
  containerWidth: number
  gapsWidth: number
  input: {
    aspects: readonly number[]
    containerWidth: number
    gapPx: number
    rowHeight: HorizontalLayoutMathConstraints
    rows: HorizontalLayoutMathRow[]
  }
  lastIndex: number
  lastRow: HorizontalLayoutMathRow
  lastRowAspectSum: number
  naturalFillHeight: number
  previousRow: HorizontalLayoutMathRow
}): HorizontalLayoutMathRow[] | null {
  const justifiedHeight = input.naturalFillHeight
  if (justifiedHeight < input.input.rowHeight.min || justifiedHeight > input.input.rowHeight.max) {
    return null
  }

  const targetDelta =
    Math.abs(justifiedHeight - input.input.rowHeight.target) /
    Math.max(1, input.input.rowHeight.target)
  if (targetDelta > LAST_ROW_JUSTIFY_TARGET_MAX_DELTA) {
    return null
  }

  const previousHeightDelta =
    Math.abs(justifiedHeight - input.previousRow.height) / Math.max(1, input.previousRow.height)
  if (previousHeightDelta > LAST_ROW_JUSTIFY_PREVIOUS_HEIGHT_MAX_DELTA) {
    return null
  }

  const lastItemAspect = getPositiveNumber(
    input.input.aspects[input.lastRow.endExclusive - 1] ?? 0,
    0.0001,
  )
  const naturalLastWidth = justifiedHeight * lastItemAspect
  const exactLastWidth = Math.max(
    1,
    input.containerWidth -
      input.gapsWidth -
      justifiedHeight * (input.lastRowAspectSum - lastItemAspect),
  )
  const correctionRatio =
    Math.abs(exactLastWidth - naturalLastWidth) / Math.max(1, naturalLastWidth)
  if (correctionRatio > LAST_ROW_JUSTIFY_LAST_CARD_CORRECTION_MAX_RATIO) {
    return null
  }

  const nextRows = input.input.rows.slice()
  nextRows[input.lastIndex] = {
    ...input.lastRow,
    height: justifiedHeight,
    isJustified: true,
  }
  return nextRows
}

function buildPrefixAspectSums(aspects: readonly number[]): Float64Array {
  const prefix = new Float64Array(aspects.length + 1)
  for (let index = 0; index < aspects.length; index++) {
    const value = getPositiveNumber(aspects[index], 0.0001)
    prefix[index + 1] = prefix[index] + value
  }
  return prefix
}

function buildSingleFallbackRow(
  itemCount: number,
  targetHeight: number,
): HorizontalLayoutMathRow[] {
  return [
    {
      endExclusive: itemCount,
      height: targetHeight,
      isJustified: false,
      start: 0,
    },
  ]
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cloneRows(rows: readonly HorizontalLayoutMathRow[]): HorizontalLayoutMathRow[] {
  return rows.map((row) => ({
    endExclusive: row.endExclusive,
    height: row.height,
    isJustified: row.isJustified,
    start: row.start,
  }))
}

function evaluateRow(input: {
  allowOutOfBandRows: boolean
  containerWidth: number
  endExclusive: number
  gapPx: number
  itemCount: number
  prefixAspectSums: Float64Array
  rowHeight: HorizontalLayoutMathConstraints
  start: number
}): null | {
  cost: number
  height: number
  isJustified: boolean
} {
  const rowCount = input.endExclusive - input.start
  if (rowCount <= 0) {
    return null
  }

  const aspectSum = input.prefixAspectSums[input.endExclusive] - input.prefixAspectSums[input.start]
  if (aspectSum <= 0) {
    return null
  }

  const gapsWidth = input.gapPx * (rowCount - 1)
  const isLastRow = input.endExclusive === input.itemCount

  if (isLastRow) {
    // Baseline behavior for a last row is non-justified at target height.
    // Underfill is intentionally cheap; overflow is expensive.
    const height = input.rowHeight.target
    const naturalWidth = height * aspectSum + gapsWidth
    const overflowRatio = Math.max(0, naturalWidth - input.containerWidth) / input.containerWidth
    const underfillRatio = Math.max(0, input.containerWidth - naturalWidth) / input.containerWidth

    return {
      cost:
        overflowRatio * overflowRatio * LAST_ROW_OVERFLOW_WEIGHT +
        underfillRatio * underfillRatio * LAST_ROW_UNDERFILL_WEIGHT,
      height,
      isJustified: false,
    }
  }

  const availableWidth = input.containerWidth - gapsWidth
  if (availableWidth <= 0) {
    return null
  }

  // For non-last rows, [min, max] is a hard constraint so all rows stay within
  // the same height band (zero inter-row variance by design). Mixed aspect
  // sets can leave that band unsatisfiable at some container widths, though,
  // and an unsatisfiable band means no layout at all - so the fallback pass
  // re-runs with the band as cost only (see computeOptimalHorizontalLayout).
  const fittedHeight = Math.max(1, availableWidth / aspectSum)
  if (
    !input.allowOutOfBandRows &&
    (fittedHeight < input.rowHeight.min || fittedHeight > input.rowHeight.max)
  ) {
    return null
  }

  const heightSpread = Math.max(1, input.rowHeight.max - input.rowHeight.min)
  const targetDelta = (fittedHeight - input.rowHeight.target) / heightSpread
  const outOfBandDelta =
    Math.abs(fittedHeight - clampNumber(fittedHeight, input.rowHeight.min, input.rowHeight.max)) /
    heightSpread

  // The out-of-band penalty is charged once per *item* absorbed into the row
  // (scaled by rowCount), not once per row: the DP sums cost over rows, so a
  // flat per-row charge underprices one severely squashed many-card row below
  // several readable rows (24 16:9 cards at 1200px collapse to ~23px).
  return {
    cost:
      targetDelta * targetDelta * NON_LAST_TARGET_WEIGHT +
      outOfBandDelta * outOfBandDelta * NON_LAST_OUT_OF_BAND_WEIGHT * rowCount +
      (rowCount === 1 ? SINGLE_ITEM_ROW_PENALTY : 0),
    height: fittedHeight,
    isJustified: true,
  }
}

function getBoundedTransitionConfig(input: {
  aspects: readonly number[]
  containerWidth: number
  gapPx: number
  rowHeight: HorizontalLayoutMathConstraints
}): BoundedTransitionConfig {
  const cacheKey = [
    Math.min(input.containerWidth, ESTIMATION_WIDTH_CAP_PX).toFixed(2),
    input.gapPx.toFixed(2),
    input.rowHeight.target.toFixed(2),
  ].join('|')

  const existingCache = transitionConfigCache.get(input.aspects)
  const cachedConfig = existingCache?.get(cacheKey)
  if (cachedConfig) {
    return cachedConfig
  }

  const totalAspect = input.aspects.reduce(
    (sum, aspect) => sum + getPositiveNumber(aspect, 0.0001),
    0,
  )
  const averageAspect = totalAspect / Math.max(1, input.aspects.length)
  const estimationWidth = Math.min(input.containerWidth, ESTIMATION_WIDTH_CAP_PX)
  const estimatedCount = Math.max(
    1,
    Math.round(
      (estimationWidth + input.gapPx) / (input.rowHeight.target * averageAspect + input.gapPx),
    ),
  )
  const maxCount = clampNumber(
    estimatedCount + TRANSITION_BUFFER,
    MIN_BOUNDED_TRANSITIONS,
    MAX_BOUNDED_TRANSITIONS,
  )

  const config: BoundedTransitionConfig = { maxCount }
  const nextCache = existingCache ?? new Map<string, BoundedTransitionConfig>()
  setLruCacheEntry(nextCache, cacheKey, config, TRANSITION_CACHE_LIMIT_PER_ASPECTS)
  transitionConfigCache.set(input.aspects, nextCache)
  return config
}

function getCachedRows(
  aspects: readonly number[],
  cacheKey: string,
): null | readonly HorizontalLayoutMathRow[] {
  const cache = layoutResultCache.get(aspects)
  if (!cache) {
    return null
  }

  const rows = cache.get(cacheKey)
  if (!rows) {
    return null
  }

  setLruCacheEntry(cache, cacheKey, rows, RESULT_CACHE_LIMIT_PER_ASPECTS)
  return rows
}

function getPositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

// We do not force the last row to be >= previous row. The post-passes are:
//   1. Anti-overflow clamp: if the non-justified last row would overflow the
//      container at target height, scale it down to fit. The clamp is
//      unconditional - the row's container clips horizontal overflow, so an
//      unclamped row does not spill, it silently drops cards off the right edge.
//      A row squashed below `min` is a readability problem; a row
//      wider than its container is a correctness one.
//   2. Adaptive justify: switch the last row to justified when its natural
//      fill height stays within the configured target/previous-row tolerances.
function harmonizeLastRowHeight(input: {
  aspects: readonly number[]
  containerWidth: number
  gapPx: number
  rowHeight: HorizontalLayoutMathConstraints
  rows: HorizontalLayoutMathRow[]
}): HorizontalLayoutMathRow[] {
  if (input.rows.length < 1) {
    return input.rows
  }

  const lastIndex = input.rows.length - 1
  const lastRow = input.rows[lastIndex]
  if (!lastRow) {
    return input.rows
  }

  const lastRowCount = lastRow.endExclusive - lastRow.start
  if (lastRowCount <= 0) {
    return input.rows
  }

  let lastRowAspectSum = 0
  for (let index = lastRow.start; index < lastRow.endExclusive; index++) {
    lastRowAspectSum += getPositiveNumber(input.aspects[index], 0.0001)
  }
  if (lastRowAspectSum <= 0) {
    return input.rows
  }

  const gapsWidth = input.gapPx * (lastRowCount - 1)
  const naturalFillHeight = Math.max(1, (input.containerWidth - gapsWidth) / lastRowAspectSum)

  // Anti-overflow clamp: if the non-justified last row's natural width at
  // target height would exceed the container, scale it down to fit. Cards
  // getting visibly clipped is worse than height distortion, so this applies
  // even when the fitted height lands below `min`.
  if (!lastRow.isJustified) {
    const naturalWidthAtTarget = lastRow.height * lastRowAspectSum + gapsWidth
    if (naturalWidthAtTarget > input.containerWidth) {
      const nextRows = input.rows.slice()
      nextRows[lastIndex] = {
        ...lastRow,
        height: naturalFillHeight,
        isJustified: false,
      }
      return nextRows
    }
  }

  // Adaptive switch to a justified last row when distortion is within the
  // configured tolerances. Only applies when a real previous justified row
  // exists to compare against.
  if (input.rows.length < 2) {
    return input.rows
  }

  const previousRow = input.rows[lastIndex - 1]
  if (!previousRow || lastRow.isJustified || !previousRow.isJustified) {
    return input.rows
  }

  const maybeJustifiedRows = buildAdaptiveJustifiedLastRow({
    containerWidth: input.containerWidth,
    gapsWidth,
    input,
    lastIndex,
    lastRow,
    lastRowAspectSum,
    naturalFillHeight,
    previousRow,
  })
  if (maybeJustifiedRows) {
    return maybeJustifiedRows
  }

  return input.rows
}

function isSquashedBelowMin(
  rows: readonly HorizontalLayoutMathRow[],
  rowHeight: HorizontalLayoutMathConstraints,
): boolean {
  return rows.some((row) => row.height < rowHeight.min)
}

function normalizeRowHeight(
  rowHeight: HorizontalLayoutMathConstraints,
): HorizontalLayoutMathConstraints {
  const min = getPositiveNumber(rowHeight.min, 1)
  const max = getPositiveNumber(rowHeight.max, min)
  const [normalizedMin, normalizedMax] = min <= max ? [min, max] : [max, min]
  const target = clampNumber(
    getPositiveNumber(rowHeight.target, normalizedMin),
    normalizedMin,
    normalizedMax,
  )

  return {
    max: normalizedMax,
    min: normalizedMin,
    target,
  }
}

function reconstructRows(input: {
  itemCount: number
  previousCut: Int32Array
  rowHeightByCut: Float64Array
  rowJustifiedByCut: Uint8Array
}): HorizontalLayoutMathRow[] {
  if (input.previousCut[input.itemCount] < 0) {
    return []
  }

  const rows: HorizontalLayoutMathRow[] = []
  let endExclusive = input.itemCount

  while (endExclusive > 0) {
    const start = input.previousCut[endExclusive]
    if (start < 0) {
      return []
    }

    const height = input.rowHeightByCut[endExclusive]
    if (!Number.isFinite(height) || height <= 0) {
      return []
    }

    rows.push({
      endExclusive,
      height,
      isJustified: input.rowJustifiedByCut[endExclusive] === 1,
      start,
    })
    endExclusive = start
  }

  rows.reverse()
  return rows
}

function relaxTransition(
  state: DynamicProgrammingState,
  start: number,
  endExclusive: number,
  row: { cost: number; height: number; isJustified: boolean },
): void {
  const nextCost = state.bestCost[start] + row.cost
  if (nextCost >= state.bestCost[endExclusive]) {
    return
  }

  state.bestCost[endExclusive] = nextCost
  state.previousCut[endExclusive] = start
  state.rowHeightByCut[endExclusive] = row.height
  state.rowJustifiedByCut[endExclusive] = row.isJustified ? 1 : 0
}

function runDynamicProgramming(input: {
  allowOutOfBandRows: boolean
  aspects: readonly number[]
  containerWidth: number
  gapPx: number
  rowHeight: HorizontalLayoutMathConstraints
}): HorizontalLayoutMathRow[] {
  // State definition:
  // bestCost[i] = minimum cost to layout first i items.
  // previousCut[i] stores the previous row start index for reconstruction.
  const itemCount = input.aspects.length
  const rowContext: RowEvaluationContext = {
    allowOutOfBandRows: input.allowOutOfBandRows,
    containerWidth: input.containerWidth,
    gapPx: input.gapPx,
    itemCount,
    prefixAspectSums: buildPrefixAspectSums(input.aspects),
    rowHeight: input.rowHeight,
  }

  const state: DynamicProgrammingState = {
    bestCost: new Float64Array(itemCount + 1),
    previousCut: new Int32Array(itemCount + 1),
    rowHeightByCut: new Float64Array(itemCount + 1),
    rowJustifiedByCut: new Uint8Array(itemCount + 1),
  }
  state.bestCost.fill(POSITIVE_INF)
  state.bestCost[0] = 0
  state.previousCut.fill(-1)

  const useBoundedTransitions = itemCount > EXACT_TRANSITION_THRESHOLD
  const boundedTransitions = useBoundedTransitions ? getBoundedTransitionConfig(input) : null

  for (let start = 0; start < itemCount; start++) {
    if (!Number.isFinite(state.bestCost[start])) {
      continue
    }

    const remaining = itemCount - start
    const maxCount = useBoundedTransitions
      ? Math.min(remaining, boundedTransitions?.maxCount ?? remaining)
      : remaining

    // Normal transitions: try row sizes in range [1..maxCount].
    runTransitionsFromStart({
      start,
      maxCount,
      rowContext,
      state,
    })

    if (useBoundedTransitions && maxCount < remaining) {
      // In bounded mode, also explicitly keep a direct "to last row" transition
      // to avoid losing valid global solutions.
      tryRelaxLastRowTransition({
        start,
        rowContext,
        state,
      })
    }
  }

  const rows = reconstructRows({
    itemCount,
    previousCut: state.previousCut,
    rowHeightByCut: state.rowHeightByCut,
    rowJustifiedByCut: state.rowJustifiedByCut,
  })

  if (rows.length > 0) {
    return harmonizeLastRowHeight({
      aspects: input.aspects,
      containerWidth: input.containerWidth,
      gapPx: input.gapPx,
      rowHeight: input.rowHeight,
      rows,
    })
  }

  // Single-row fallback: ensure it doesn't overflow the container either.
  return harmonizeLastRowHeight({
    aspects: input.aspects,
    containerWidth: input.containerWidth,
    gapPx: input.gapPx,
    rowHeight: input.rowHeight,
    rows: buildSingleFallbackRow(itemCount, input.rowHeight.target),
  })
}

function runTransitionsFromStart(input: {
  maxCount: number
  rowContext: RowEvaluationContext
  start: number
  state: DynamicProgrammingState
}): void {
  for (let count = 1; count <= input.maxCount; count++) {
    const endExclusive = input.start + count
    const row = evaluateRow({
      allowOutOfBandRows: input.rowContext.allowOutOfBandRows,
      containerWidth: input.rowContext.containerWidth,
      endExclusive,
      gapPx: input.rowContext.gapPx,
      itemCount: input.rowContext.itemCount,
      prefixAspectSums: input.rowContext.prefixAspectSums,
      rowHeight: input.rowContext.rowHeight,
      start: input.start,
    })
    if (!row) {
      continue
    }

    relaxTransition(input.state, input.start, endExclusive, row)
  }
}

function setCachedRows(
  aspects: readonly number[],
  cacheKey: string,
  rows: readonly HorizontalLayoutMathRow[],
): void {
  const cache =
    layoutResultCache.get(aspects) ?? new Map<string, readonly HorizontalLayoutMathRow[]>()
  setLruCacheEntry(cache, cacheKey, rows, RESULT_CACHE_LIMIT_PER_ASPECTS)
  layoutResultCache.set(aspects, cache)
}

function setLruCacheEntry<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, value)

  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) {
      break
    }
    cache.delete(oldestKey)
  }
}

function tryRelaxLastRowTransition(input: {
  rowContext: RowEvaluationContext
  start: number
  state: DynamicProgrammingState
}): void {
  const endExclusive = input.rowContext.itemCount
  const row = evaluateRow({
    allowOutOfBandRows: input.rowContext.allowOutOfBandRows,
    containerWidth: input.rowContext.containerWidth,
    endExclusive,
    gapPx: input.rowContext.gapPx,
    itemCount: input.rowContext.itemCount,
    prefixAspectSums: input.rowContext.prefixAspectSums,
    rowHeight: input.rowContext.rowHeight,
    start: input.start,
  })
  if (!row) {
    return
  }

  relaxTransition(input.state, input.start, endExclusive, row)
}
