import { PlanDiff, RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { Logger } from '@reelmakeeasy/common/utils/logger'

// Only the top layers of the render-plan tree carry structurally meaningful
// changes (tracks/segs); deeper subtrees are collapsed to a single 'replace'.
const MAX_DEPTH = 2

const logger = Logger.get('project.render-plan-diff')

type DiffOp = { op: 'add' | 'remove' | 'replace'; path: Array<number | string> }

// Produces a PlanDiff (additions/deletions/
// updates keyed by node id + dotted path) describing how curr differs from prev,
// so the engine can RefreshRenderPlanDiff instead of re-parsing the whole plan.
// Returns undefined when either plan is missing (caller falls back to a full
// refresh) or when diffing throws.
export function getRenderPlanDiff(
  prev: RenderPlan | undefined,
  curr: RenderPlan | undefined,
): PlanDiff | undefined {
  if (!prev || !curr) {
    return undefined
  }
  try {
    const treeChanges: PlanDiff = { additions: [], deletions: [], updates: [] }
    const prevKeyIndexMap = new Map<string, number>()
    const currKeyIndexMap = new Map<string, number>()
    const changes = diff(
      convertObjectArraysToKeyValue(prev, 0, prevKeyIndexMap),
      convertObjectArraysToKeyValue(curr, 0, currKeyIndexMap),
    )
    const valuableChanges = pickAndMergeValuableChanges(changes)
    pushNodesToTreeChanges(
      treeChanges,
      valuableChanges,
      prevKeyIndexMap,
      currKeyIndexMap,
      [],
      prev,
      curr,
    )
    return treeChanges
  } catch (error) {
    logger.error({ error }, 'getRenderPlanDiff error:')
    return undefined
  }
}

// True when a diff carries no actual changes. getRenderPlanDiff returns an
// empty-but-defined PlanDiff (not undefined) when prev/curr are structurally equal,
// so callers use this to skip the engine round-trip entirely.
export function isEmptyPlanDiff(diff: PlanDiff): boolean {
  return diff.additions.length === 0 && diff.deletions.length === 0 && diff.updates.length === 0
}

function addNode(treeChanges: PlanDiff, idx: number, id: string, path: string) {
  treeChanges.additions.push({ id, idx, path })
}

// 1. convert object arrays to key-value pairs, because array diffs are hard to
//    compare positionally (an id-keyed map is stable under insert/remove);
// 2. record each element's original index in keyIndexMap for later idx lookup.
function convertObjectArraysToKeyValue(
  value: unknown,
  depth: number,
  keyIndexMap: Map<string, number>,
): unknown {
  if (depth >= MAX_DEPTH || !isRecord(value)) {
    return value
  }
  const transformed: Record<string, unknown> = { ...value }
  // Snapshot keys before mutating (encoded keys are added / array keys removed).
  for (const key of Object.keys(value)) {
    const child = transformed[key]
    if (Array.isArray(child)) {
      if (depth === 1 && key !== 'segs') {
        continue
      }
      child.forEach((item, index) => {
        const id = isRecord(item) && typeof item.id === 'string' ? item.id : '-'
        const encoded = encodeKeyName(key, id)
        keyIndexMap.set(encoded, index)
        transformed[encoded] = convertObjectArraysToKeyValue(item, depth + 1, keyIndexMap)
      })
      delete transformed[key]
    } else if (isRecord(child)) {
      transformed[key] = convertObjectArraysToKeyValue(child, depth + 1, keyIndexMap)
    }
  }
  return transformed
}

function decodeKeyName(
  key: string,
  keyIndexMap: Map<string, number>,
): undefined | { idx: number; key: string } {
  const parts = key.split('__')
  if (parts.length === 1) {
    return undefined
  }
  return { idx: keyIndexMap.get(key) ?? 0, key: parts[0] }
}

function deleteNode(treeChanges: PlanDiff, idx: number, id: string, path: string) {
  treeChanges.deletions.push({ id, idx, path })
}

// Minimal structural diff producing just-diff's { op, path } shape for the subset
// getRenderPlanDiff relies on. The plans are pre-transformed into nested plain
// objects (object arrays -> id-keyed maps), so object recursion plus leaf-replace
// is sufficient; any remaining arrays/primitives collapse to a single 'replace'
// (which traverseAndSlimMap would force past MAX_DEPTH anyway). This avoids a
// runtime dependency on `just-diff`.
function diff(
  prev: unknown,
  curr: unknown,
  path: Array<number | string> = [],
  out: DiffOp[] = [],
): DiffOp[] {
  if (isRecord(prev) && isRecord(curr)) {
    for (const key of Object.keys(prev)) {
      if (key in curr) {
        diff(prev[key], curr[key], [...path, key], out)
      } else {
        out.push({ op: 'remove', path: [...path, key] })
      }
    }
    for (const key of Object.keys(curr)) {
      if (!(key in prev)) {
        out.push({ op: 'add', path: [...path, key] })
      }
    }
    return out
  }
  if (JSON.stringify(prev) !== JSON.stringify(curr)) {
    out.push({ op: 'replace', path })
  }
  return out
}

function encodeKeyName(key: string, id: string) {
  return `${key}__${id}`
}

function getRealKeyPath(keys: string[], keyIndexMap: Map<string, number>): Array<number | string> {
  const res: Array<number | string> = []
  for (const key of keys) {
    const decoded = decodeKeyName(key, keyIndexMap)
    if (decoded) {
      res.push(decoded.key, decoded.idx)
    } else {
      res.push(key)
    }
  }
  return res
}

function getValue(obj: unknown, keyPath: Array<number | string>): unknown {
  let current: unknown = obj
  for (const key of keyPath) {
    if (isRecord(current) && key in current) {
      current = current[key]
    } else if (Array.isArray(current) && typeof key === 'number') {
      current = current[key]
    } else {
      return undefined
    }
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nodeId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined
}

// The tree has many layers; keep ONLY the several top layers, collapsing the rest
// to a single 'replace' so the diff stays shallow and cheap for the engine.
function pickAndMergeValuableChanges(changes: DiffOp[]): unknown {
  const map: Record<string, unknown> = {}
  for (const change of changes) {
    const path = change.path
    if (path.length === 0) {
      continue
    }
    let node = map
    for (let i = 0; i < path.length - 1; i++) {
      const key = String(path[i])
      if (!isRecord(node[key])) {
        node[key] = {}
      }
      node = node[key] as Record<string, unknown>
    }
    node[String(path[path.length - 1])] = change.op
  }
  return traverseAndSlimMap(map, 0, null)
}

// Resolve a single leaf op string to the real node id + dotted path and record it
// under the matching bucket. 'add'/'replace' resolve against curr (new index map),
// 'remove' against prev (old index map).
function pushLeafChange(
  treeChanges: PlanDiff,
  op: string,
  keys: string[],
  prevKeyIndexMap: Map<string, number>,
  currKeyIndexMap: Map<string, number>,
  prev: RenderPlan,
  curr: RenderPlan,
) {
  if (op === 'replace') {
    const realKeyPath = getRealKeyPath(keys, currKeyIndexMap)
    // For a track-level (non-seg) replace, the node is the track itself (first two
    // path segments); otherwise the node sits at the full path.
    const target =
      keys[0]?.startsWith('tracks') && !!keys[1] && !keys[1].startsWith('segs')
        ? getValue(curr, realKeyPath.slice(0, 2))
        : getValue(curr, realKeyPath)
    const id = nodeId(target)
    if (id) {
      updateNode(treeChanges, id, realKeyPath.join('.'))
    }
    return
  }
  if (op === 'add') {
    const realKeyPath = getRealKeyPath(keys, currKeyIndexMap)
    const id = nodeId(getValue(curr, realKeyPath))
    const idx = decodeKeyName(keys[keys.length - 1], currKeyIndexMap)?.idx ?? 0
    if (id) {
      addNode(treeChanges, idx, id, realKeyPath.join('.'))
    }
    return
  }
  const realKeyPath = getRealKeyPath(keys, prevKeyIndexMap)
  const id = nodeId(getValue(prev, realKeyPath))
  const idx = decodeKeyName(keys[keys.length - 1], prevKeyIndexMap)?.idx ?? 0
  if (id) {
    deleteNode(treeChanges, idx, id, realKeyPath.join('.'))
  }
}

// Collect the slimmed change tree into treeChanges. keys is the path walked so
// far (encoded keys); a leaf op string ('add' | 'remove' | 'replace') resolves to
// the real node id + dotted path via the appropriate key-index map.
function pushNodesToTreeChanges(
  treeChanges: PlanDiff,
  value: unknown,
  prevKeyIndexMap: Map<string, number>,
  currKeyIndexMap: Map<string, number>,
  keys: string[],
  prev: RenderPlan,
  curr: RenderPlan,
) {
  if (typeof value === 'string') {
    pushLeafChange(treeChanges, value, keys, prevKeyIndexMap, currKeyIndexMap, prev, curr)
    return
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      pushNodesToTreeChanges(
        treeChanges,
        value[key],
        prevKeyIndexMap,
        currKeyIndexMap,
        [...keys, key],
        prev,
        curr,
      )
    }
  }
}

function traverseAndSlimMap(value: unknown, depth: number, key: null | string): unknown {
  if (!isRecord(value)) {
    return value
  }
  if (depth >= MAX_DEPTH || key === 'videoInfo' || key === 'audioInfo') {
    return 'replace'
  }
  for (const childKey of Object.keys(value)) {
    if (depth === 1 && !isRecord(value[childKey]) && !childKey.startsWith('segs')) {
      value[childKey] = 'replace'
    } else {
      value[childKey] = traverseAndSlimMap(value[childKey], depth + 1, childKey)
    }
  }
  return value
}

function updateNode(treeChanges: PlanDiff, id: string, path: string) {
  treeChanges.updates.push({ id, path })
}
