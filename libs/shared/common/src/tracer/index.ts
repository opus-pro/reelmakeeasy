import type { TraceInfo } from '@shared/types/api/req-ctx'

/**
 * Distributed tracing is not wired in ReelMakeEasy. These keep the call sites of
 * the former APM integration compiling and return empty trace data.
 */
export type BaseTraceOptions = {
  sampleRate?: number
  serviceName?: string
}

export const initTracer = (_opts?: BaseTraceOptions, _extOptions?: unknown): undefined => undefined

export const getFullTraceId = (): string | undefined => undefined

export const getTraceInfo = (): TraceInfo | undefined => undefined

export const getFullTraceIdFromSpan = (_span: unknown): string | undefined => undefined

export const getTraceInfoFromSpan = (_span: unknown): TraceInfo | undefined => undefined

export function carrierToSpanCtx(_carrier?: Record<string, number | string>): undefined {
  return undefined
}
