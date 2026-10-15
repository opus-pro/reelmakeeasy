import { EventEmitter } from 'node:events'

import { MessageEvent } from '@nestjs/common'
import {
  EMPTY,
  finalize,
  fromEvent,
  interval,
  map,
  merge,
  Observable,
  Subject,
  takeUntil,
} from 'rxjs'

import { serveStoredUrls } from '../storage/address'

/**
 * The wire form of an event's data, with every stored file address in a URL field
 * served as a URL: saved records hold addresses only, and this is where they leave
 * for the browser (see `serveStoredUrls`). Data already encoded as JSON is served too.
 */
function serveEventData(data: unknown): string {
  if (typeof data !== 'string') return JSON.stringify(serveStoredUrls(data))
  if (!data.includes('store://') && !data.includes('preset://')) return data
  try {
    const parsed: unknown = JSON.parse(data)
    const served = serveStoredUrls(parsed)
    return served === parsed ? data : JSON.stringify(served)
  } catch {
    return data
  }
}

// Reserved event types we use internally
const RESERVED = new Set(['complete', 'error', 'hello', 'ping'])

/** Events kept for the next subscriber while nobody is listening. */
export const SSE_PENDING_LIMIT = 1000

export class SSEError extends Error {
  constructor(_: string) {
    super()
  }
}

export const SSE_DISCONNECTED = new SSEError('SSE client disconnected')
export const SSE_TYPE_MISSING = new SSEError('SSE event type missing')
export const SSE_TYPE_RESERVED = new SSEError('SSE event type reserved')
export const SSE_NOT_INITED = new SSEError('SSE factory not inited')

export type SSEOptions = {
  heartbeatMs?: number
  /** Called once when the bus ends or fails, so its owner can forget it. */
  onClose?: () => void
}

/**
 * One in-process event channel (a project, a workflow, a UIP session).
 *
 * Events fan out to every connected subscriber. Events pushed while nobody is
 * connected are held (up to SSE_PENDING_LIMIT, oldest dropped first) and
 * delivered to the next subscriber, so a client that connects late or
 * reconnects after a drop catches up on what it missed. Delivered events carry
 * an increasing `id`.
 */
export class SSEBus {
  public get closed(): boolean {
    return this.isClosed
  }
  private readonly emitter = new EventEmitter()
  private readonly heartbeat$: Observable<MessageEvent>
  private isClosed = false
  private lastActivityAt = Date.now()
  private readonly onClose?: () => void
  private readonly pending: MessageEvent[] = []
  private seq = 0
  private readonly stop$ = new Subject<void>()

  private subscriberCount = 0

  constructor(opts?: SSEOptions) {
    const heartbeatMs = opts?.heartbeatMs ?? 10_000
    this.onClose = opts?.onClose
    // Each subscriber adds a listener; many viewers of one project is normal.
    this.emitter.setMaxListeners(0)
    this.heartbeat$ =
      heartbeatMs > 0
        ? interval(heartbeatMs).pipe(
            map(() => ({ type: 'ping', data: Date.now().toString() }) as MessageEvent),
          )
        : EMPTY
  }

  /** Close the bus without sending a final event (shutdown). */
  public afterEnd(): void {
    this.markClosed()
  }

  public async end(): Promise<void> {
    if (this.isClosed) {
      return
    }
    this.deliver({ type: 'complete', data: Date.now().toString() })
    this.markClosed()
  }

  // Terminate stream with error
  public async fail(err: Error): Promise<void> {
    if (this.isClosed) {
      return
    }
    this.deliver({ type: 'error', data: err.message })
    this.markClosed()
  }

  public getLocalSubscriberCount(): number {
    return this.subscriberCount
  }

  /** Milliseconds since the last push or subscriber change. */
  public idleMs(now = Date.now()): number {
    return now - this.lastActivityAt
  }

  public async push(evt: MessageEvent): Promise<void> {
    if (this.isClosed) {
      throw SSE_DISCONNECTED
    }
    this.validate(evt)
    this.deliver(evt)
  }

  public safeRun<T>(
    fn: () => Promise<T> | T,
    opts?: { onError?: (err: Error) => void; onFinally?: () => void },
  ): void {
    Promise.resolve()
      .then(fn)
      .catch((e) => {
        const err = e instanceof Error ? e : new Error(String(e))
        try {
          opts?.onError?.(err)
        } catch {
          /* empty */
        }
        this.fail(err)
      })
      .finally(() => {
        try {
          opts?.onFinally?.()
        } catch {
          /* empty */
        }
      })
  }

  public stream(opts?: {
    lastEventId?: string
    onCleanup?: () => void
    onStart?: () => void
  }): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      if (this.isClosed) {
        subscriber.complete()
        return
      }
      this.subscriberCount++
      this.lastActivityAt = Date.now()
      // emit hello once on subscriber
      subscriber.next({ type: 'hello', data: Date.now().toString() })
      // Catch up on what was pushed while nobody was connected.
      for (const evt of this.pending.splice(0)) {
        subscriber.next(evt)
      }

      const sub = merge(
        this.heartbeat$,
        fromEvent(this.emitter, 'event') as Observable<MessageEvent>,
      )
        .pipe(
          takeUntil(this.stop$),
          finalize(() => {
            this.subscriberCount--
            this.lastActivityAt = Date.now()
            opts?.onCleanup?.()
          }),
        )
        .subscribe(subscriber)
      // After subscribing, so an event onStart pushes reaches this subscriber
      // instead of the pending buffer.
      opts?.onStart?.()

      return () => {
        sub.unsubscribe()
      }
    })
  }

  private deliver(evt: MessageEvent): void {
    this.lastActivityAt = Date.now()
    // Same wire shape the endpoints expect:
    // a string `type`, a string `data` (objects JSON-encoded) and an `id`.
    const out: MessageEvent = {
      id: evt.id ?? `${Date.now()}-${this.seq++}`,
      type: evt.type || 'stream',
      data: serveEventData(evt.data),
    }
    if (this.subscriberCount > 0) {
      this.emitter.emit('event', out)
      return
    }
    this.pending.push(out)
    if (this.pending.length > SSE_PENDING_LIMIT) {
      this.pending.shift()
    }
  }

  private markClosed(): void {
    if (this.isClosed) {
      return
    }
    this.isClosed = true
    this.pending.length = 0
    this.stop$.next()
    this.stop$.complete()
    this.emitter.removeAllListeners()
    this.onClose?.()
  }

  private validate(evt: MessageEvent): void {
    const type = evt?.type
    if (!type) {
      throw SSE_TYPE_MISSING
    }
    if (RESERVED.has(type)) {
      throw SSE_TYPE_RESERVED
    }
  }
}
