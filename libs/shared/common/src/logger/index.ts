import * as path from 'node:path'

import { omit } from 'lodash-es'
import pino from 'pino'

import { JobContext } from '../job-context'
import { getFullTraceId } from '../tracer'
import { getReqContext } from '../utils/req-ctx'

import { LOG_META_PII_KEYS } from './log-meta-pii-keys'

// `%%` is an escaped percent, so it consumes no argument.
function countPlaceholders(message: string): number {
  return (message.match(/%[%sdifoOj]/g) ?? []).filter((token) => token !== '%%').length
}

function foldSurplusArgs(base: object, surplusArgs: unknown[]): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  const extraArgs: unknown[] = []
  for (const surplus of surplusArgs) {
    if (surplus instanceof Error) {
      // only the `error` key is serialized by pino, so render any other key ourselves
      if (merged['error'] === undefined) {
        merged['error'] = surplus
      } else {
        merged['error2'] = pino.stdSerializers.err(surplus)
      }
    } else if (isPlainObject(surplus)) {
      for (const [key, value] of Object.entries(surplus)) {
        if (!(key in merged)) {
          merged[key] = value
        }
      }
    } else {
      extraArgs.push(surplus)
    }
  }
  if (extraArgs.length > 0) {
    merged[merged['extraArgs'] === undefined ? 'extraArgs' : 'extraArgs2'] = extraArgs
  }
  return merged
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Pino drops trailing args that no printf placeholder consumes. Move them into the
 * merging object so `logger.error('msg', err)` still records the error.
 */
export function rescueSurplusLogArgs(args: unknown[]): unknown[] {
  const hasMergingObject = typeof args[0] === 'object' && args[0] !== null
  const messageIndex = hasMergingObject ? 1 : 0
  const message = args[messageIndex]
  // scan for placeholders only once there is something that could be dropped
  if (typeof message !== 'string' || args.length <= messageIndex + 1) {
    return args
  }
  const keepCount = messageIndex + 1 + countPlaceholders(message)
  const surplusArgs = args.slice(keepCount).filter((arg) => arg !== undefined)
  if (surplusArgs.length === 0) {
    return args
  }

  const merged = foldSurplusArgs(hasMergingObject ? (args[0] as object) : {}, surplusArgs)
  return [merged, ...args.slice(messageIndex, keepCount)]
}

const isDev = process.env['NODE_ENV'] === 'development'
const isTest = process.env['NODE_ENV'] === 'test' || process.env['JEST_WORKER_ID'] !== undefined
const logLevel = process.env['LOG_LEVEL'] || (isTest ? 'warn' : isDev ? 'debug' : 'info')
// Use config-based log directory with fallback to logs subdirectory
const logDir = process.env['LOG_DIR'] || path.join(process.cwd(), 'logs')
// Initialize logger with base configuration
// Note: When using transport.targets, formatters must be removed
const baseConfig = {
  base: {
    env: process.env['NODE_ENV'] || 'development',
    service: 'reelmakeeasy',
  },
  mixin() {
    // Automatically inject context from AsyncLocalStorage
    // Values of CTX are pass in by JobContext.run(CTX, fn)
    let ctx: Record<string, unknown>
    try {
      // skip noise (modelSwitch) and PII keys (shared list, see log-meta-pii-keys.ts)
      ctx = omit(JobContext.getFullContext({}) || {}, 'modelSwitch', ...LOG_META_PII_KEYS)
    } catch {
      ctx = {}
    }
    try {
      const traceId = getFullTraceId()
      if (traceId) {
        ctx = { ...ctx, traceId }
      }
      const reqCtx = getReqContext()
      ctx = { ...ctx, userId: reqCtx.user_id, loginId: reqCtx.login_id, orgId: reqCtx.org_id }
      return ctx
    } catch {
      // ignore and just return ctx
    }
    return { ...ctx }
  },
  serializers: {
    error: pino.stdSerializers.err,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}

// Shared formatters for consistent output
const sharedFormatters = {
  level: (label: string) => {
    return { level: label.toUpperCase() }
  },
}

/** If log has context, show `[context]msg`, otherwise just msg. */
function getLoggerStream() {
  if (isTest) {
    return pino.multistream([
      {
        level: logLevel,
        stream: pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore:
              'pid,hostname,env,component,service,version,projectId,userId,userEmail,conversationId,operationId',
            messageFormat: '[{context}] {msg}',
            singleLine: true,
          },
        }),
      },
    ])
  }

  if (isDev) {
    return pino.multistream([
      {
        level: logLevel,
        stream: pino.destination({
          dest: path.join(logDir, 'app.log'),
          mkdir: true,
          sync: true, // Use sync write to prevent "sonic boom is not ready yet" error
        }),
      },
      {
        level: logLevel,
        stream: pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore:
              'pid,hostname,env,component,service,version,projectId,userId,userEmail,conversationId,operationId',
            messageFormat: '{msg}',
            singleLine: true,
          },
        }),
      },
    ])
  }

  return process.stdout
}

// Create base pino logger (internal use)
const basePinoLogger = pino(
  {
    ...(isDev ? {} : baseConfig),
    serializers: baseConfig.serializers,
    level: logLevel,
    formatters: sharedFormatters,
    hooks: {
      logMethod(args: Parameters<pino.LogFn>, method: pino.LogFn) {
        method.apply(this, rescueSurplusLogArgs(args) as Parameters<pino.LogFn>)
      },
    },
  },
  getLoggerStream(),
)

/**
 * Turn object into string
 * @example `{ a: 12, b: '23' }` ==> `a:12; b:23`
 */
export function objectToFlatString(obj: Record<string, unknown>, joiner = '; '): string {
  return Object.entries(obj)
    .map(([key, value]) => `${key}:${value}`)
    .join(joiner)
}

export function serializeErrorCause(errorCause: unknown): string {
  if (!errorCause) {
    return 'null'
  }

  try {
    return JSON.stringify(errorCause)
  } catch {
    try {
      return String(errorCause)
    } catch {
      return '<Unserializable>'
    }
  }
}

// Export the base pino logger for external use (compatible with operationContext.logger interface)
export const agentLogger = basePinoLogger

// Enhanced Logger class that's compatible with NestJS Logger interface
export class Logger {
  private context?: string
  private pinoLogger: pino.Logger

  constructor(context?: string, parentLogger?: pino.Logger) {
    this.context = context
    // Create pino child directly to avoid circular dependency
    const baseLogger = parentLogger || basePinoLogger
    if (context) {
      this.pinoLogger = baseLogger.child({ context })
    } else {
      this.pinoLogger = baseLogger
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    // Create child pino logger with bindings
    const childPino = this.pinoLogger.child(bindings)
    // Return Logger instance wrapping the child pino logger
    return new Logger(this.context, childPino)
  }

  debug(message: string, ...args: unknown[]): void
  debug(obj: object, message?: string, ...args: unknown[]): void
  debug(obj: unknown, message?: unknown, ...args: unknown[]): void {
    const { ctx, rest } = this.unifyParams(obj, message, ...args)
    this.pinoLogger.debug(ctx, ...rest)
  }
  error(message: string, ...args: unknown[]): void
  error(obj: object, message?: string, ...args: unknown[]): void
  error(obj: unknown, message?: unknown, ...args: unknown[]): void {
    const { ctx, rest } = this.unifyParams(obj, message, ...args)
    this.pinoLogger.error(ctx, ...rest)
  }
  // Expose the underlying Pino logger for advanced usage
  getPinoLogger(): pino.Logger {
    return this.pinoLogger
  }
  info(message: string, ...args: unknown[]): void
  info(obj: object, message?: string, ...args: unknown[]): void
  info(obj: unknown, message?: unknown, ...args: unknown[]): void {
    const { ctx, rest } = this.unifyParams(obj, message, ...args)
    this.pinoLogger.info(ctx, ...rest)
  }
  log(message: string, ...args: unknown[]): void
  log(obj: object, message?: string, ...args: unknown[]): void
  log(obj: unknown, message?: unknown, ...args: unknown[]): void {
    // NestJS log method - treat as info
    this.info(obj as string, message as string, ...args)
  }
  trace(message: string, ...args: unknown[]): void
  trace(obj: object, message?: string, ...args: unknown[]): void
  trace(obj: unknown, message?: unknown, ...args: unknown[]): void {
    const { ctx, rest } = this.unifyParams(obj, message, ...args)
    this.pinoLogger.trace(ctx, ...rest)
  }
  verbose(message: string, ...args: unknown[]): void
  verbose(obj: object, message?: string, ...args: unknown[]): void
  verbose(obj: unknown, message?: unknown, ...args: unknown[]): void {
    this.trace(obj as never, message as never, ...args)
  }
  warn(message: string, ...args: unknown[]): void
  warn(obj: object, message?: string, ...args: unknown[]): void
  warn(obj: unknown, message?: unknown, ...args: unknown[]): void {
    const { ctx, rest } = this.unifyParams(obj, message, ...args)
    this.pinoLogger.warn(ctx, ...rest)
  }

  /**
   * Get context from JobContext and merge with log object
   */
  private enrichWithContext(obj: object): object {
    try {
      const ctx = JobContext.getFullContext({})
      const contextFields: Record<string, unknown> = {}
      if (ctx?.projectId) {
        contextFields['projectId'] = ctx.projectId
      }
      if (ctx?.userId) {
        contextFields['userId'] = ctx.userId
      }
      return { ...contextFields, ...obj }
    } catch {
      return obj
    }
  }

  private unifyParams(
    obj: unknown,
    message?: unknown,
    ...args: unknown[]
  ): { ctx: object; rest: string[] } {
    if (obj instanceof Error) {
      // Error's own message/stack are non-enumerable, so `{...obj}` silently drops them.
      // Nest calls `logger.error(exception)` with no message, so fall back to obj.message
      // for the log line and let the pino `error` serializer render stack/cause.
      const ctx = this.enrichWithContext({ error: obj })
      const rest = [(message as string) ?? obj.message, ...args]
      return { ctx, rest: rest as string[] }
    }
    const ctx = this.enrichWithContext((typeof obj === 'object' && obj) || {})
    const rest =
      typeof obj === 'string' ? [obj, message as string, ...args] : [message as string, ...args]
    return { ctx, rest: rest as string[] }
  }
}

// Export Logger class instance instead of raw pino to add the job context fields
export const logger = new Logger()

export function createSubLogger(context?: string, parentLogger?: pino.Logger): Logger {
  // Return Logger class instance instead of pino.Logger to add the job context fields
  return new Logger(context, parentLogger)
}

export const getLogger = (name: string) => {
  return new Logger(name)
}
