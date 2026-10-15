import { logger } from '../logger'

import { SSE_NOT_INITED, SSEBus } from './sse'

/** A bus with no subscribers and no pushes for this long is dropped. */
const IDLE_BUS_TTL_MS = 300_000

/**
 * Registry of in-process SSE buses, one per channel key.
 *
 * Producers (workflows, services) and the `@Sse` endpoints run in the same
 * process, so a bus is just a shared object: `getSSEBus(key)` returns the same
 * instance to both sides until the bus ends, fails or goes idle.
 */
export class SSEFactory {
  private static readonly buses = new Map<string, SSEBus>()
  private static gcTimer?: NodeJS.Timeout
  private static inited = false
  private static serviceName = ''
  private static shuttingDown = false

  static async getSSEBus(channelKey: string): Promise<null | SSEBus> {
    if (!this.inited || this.shuttingDown) {
      throw SSE_NOT_INITED
    }
    const existing = this.buses.get(channelKey)
    if (existing && !existing.closed) {
      return existing
    }
    const bus: SSEBus = new SSEBus({
      onClose: () => {
        // Only forget this instance; a newer bus may already own the key.
        if (this.buses.get(channelKey) === bus) {
          this.buses.delete(channelKey)
        }
      },
    })
    this.buses.set(channelKey, bus)
    logger.debug('[SSE] %s bus created for %s', this.serviceName, channelKey)
    return bus
  }

  public static init(serviceName: string): void {
    this.serviceName = serviceName
    this.shuttingDown = false
    this.startIdleBusCleanup()
    this.inited = true
  }

  /**
   * Terminate all in-flight SSE streams and stop the cleanup timer so a graceful
   * shutdown's app.close() can resolve instead of hanging on long-lived
   * connections until SIGKILL. Idempotent.
   */
  public static async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return
    }
    this.shuttingDown = true
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = undefined
    }
    logger.info('[SSE] shutting down, ending %d active buses', this.buses.size)
    // afterEnd() fires stop$ -> streams complete via takeUntil -> the SSE HTTP
    // responses end, unblocking httpServer.close().
    const buses = [...this.buses.values()]
    this.buses.clear()
    buses.forEach((bus) => bus.afterEnd())
  }

  private static startIdleBusCleanup(): void {
    if (this.gcTimer) {
      return
    }
    this.gcTimer = setInterval(() => {
      const now = Date.now()
      let removed = 0
      for (const [key, bus] of this.buses) {
        if (bus.getLocalSubscriberCount() <= 0 && bus.idleMs(now) >= IDLE_BUS_TTL_MS) {
          this.buses.delete(key)
          removed++
        }
      }
      if (removed > 0) {
        logger.info('[SSE] %d idle buses removed', removed)
      }
    }, IDLE_BUS_TTL_MS)
    this.gcTimer.unref()
  }
}
