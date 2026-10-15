// timer-persist.ts
import { performance } from 'node:perf_hooks'

import { logger } from '../logger'

interface Stat {
  count: number
  totalTime: number // in milliseconds
}

// In-memory data
const stats: Record<string, Stat> & {
  hostname?: string
  result?: string
} = {}
const startStack: Record<string, number[]> = {}

/**
 * Mark the end of a timed block and accumulate stats.
 */
export function markEnd(name: string): number {
  const stack = startStack[name]
  if (!stack?.length) {
    logger.warn(`[timer] markEnd() without matching markStart() for "${name}"`)
    return -1
  }
  const startTime = stack.pop()
  if (startTime === undefined) {
    return -1
  }
  const delta = performance.now() - startTime
  const stat: Stat = (stats[name] ??= { count: 0, totalTime: 0 })
  stat.count++
  stat.totalTime += delta
  return delta
}

/**
 * Mark the start of a timed block.
 */
export function markStart(name: string) {
  const now = performance.now()
  ;(startStack[name] ??= []).push(now)
}

/**
 * Generic timeout wrapper. Allows custom handling on timeout via options.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<T> | T = () => {
    logger.error(`[timer] operation timed out after ${timeoutMs}ms`)
    throw new Error(`operation timed out after ${timeoutMs}ms`)
  },
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutPromise: Promise<T> = new Promise<T>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        Promise.resolve(onTimeout()).then(resolve).catch(reject)
      }, timeoutMs)
    })

    return (await Promise.race([promise, timeoutPromise])) as T
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
