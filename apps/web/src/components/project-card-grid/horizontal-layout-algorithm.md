# ProjectCardGrid Horizontal Layout Algorithm

This document explains why `horizontal-layout-math.ts` exists and how it works.

## Problem We Need to Solve

For horizontal card layout, we want all of the following at the same time:

- Respect row height constraints: `min`, `max`, `target`.
- Keep rows visually stable (avoid sudden tiny/tall rows).
- Preserve card order and click index semantics.
- Keep performance acceptable for both small and very large lists.
- Handle last-row aesthetics without forcing a single fixed policy.

## Core Model

Each card is represented by its width/height aspect weight:

- `aspect = width / height`
- For default template ratios:
  - `9:16 -> 9/16`
  - `1:1 -> 1`
  - `16:9 -> 16/9`

For a candidate row with cards `[i..j]`:

- `aspectSum = sum(aspect[i..j])`
- `gapsWidth = gap * (rowCount - 1)`
- `fittedHeight = (containerWidth - gapsWidth) / aspectSum`

## Optimization Strategy

We use dynamic programming over prefixes:

- `bestCost[k]` = minimal cost for the first `k` cards.
- Transition `start -> endExclusive` means `[start..endExclusive-1]` is one row.
- `previousCut[endExclusive]` stores reconstruction path.

Row cost design:

- Non-last row:
  - Penalize distance to `target`.
  - Penalize below-`min` and above-`max` more strongly.
  - Add a small penalty for single-item rows.
- Last row baseline:
  - Default is non-justified at `target`.
  - Overflow penalty is high; underfill penalty is low.

## Adaptive Last Row Justify

After DP reconstruction, we run a post-pass:

- If last row is currently non-justified, we evaluate whether switching it to justified is safe.
- We switch to justified only if all checks pass:
  - Justified height stays within `[min, max]`.
  - Height is close enough to `target`.
  - Height delta vs previous row is small enough.
  - Last-card width correction ratio is below a threshold.

If checks fail, we keep non-justified last row.

## Caching and Performance

Caching:

- Result cache: `WeakMap<aspectsRef, Map<inputKey, rows>>`
- Transition-config cache (for large `n`): `WeakMap<aspectsRef, Map<inputKey, boundedConfig>>`
- Both use LRU-style size limits per aspects reference.

Complexity:

- Exact mode (`n <= EXACT_TRANSITION_THRESHOLD`): `O(n^2)`.
- Bounded mode (`n` large): `O(n * k)` where `k` is bounded candidate row size.
- Prefix sums keep row evaluation `O(1)` per transition.

## Why This Is Better Than Pure Greedy

Greedy only optimizes the current row. This algorithm optimizes row breaks globally, so it can:

- Better follow `target` across the whole grid.
- Reduce visible variance and awkward tail rows.
- Keep behavior stable for real-world mixed aspect sets.
