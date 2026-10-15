import { getKvStore } from '@reelmakeeasy/common/kv'
import { logger } from '@reelmakeeasy/common/logger'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { INestApplication } from '@nestjs/common'

// Upper bound on a clean shutdown after SIGTERM/SIGINT. Keep it below whatever
// grace period a process supervisor (systemd, Docker, a container platform)
// allows before it sends SIGKILL, so the process always exits on its own.
const SHUTDOWN_TIMEOUT_MS = 40_000

export function gracefulShutdown(app: INestApplication) {
  let shuttingDown = false
  const signals = ['SIGTERM', 'SIGINT']
  signals.forEach((signal) => {
    process.on(signal, async () => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true
      logger.warn(`Received ${signal}, shutting down gracefully...`)

      // Hard deadline: app.close() can hang on long-lived connections, so
      // guarantee the process exits before SIGKILL regardless.
      const forceExit = setTimeout(() => {
        logger.error(`Graceful shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`)
        process.exit(0)
      }, SHUTDOWN_TIMEOUT_MS)
      forceExit.unref()

      try {
        // End in-flight SSE streams first; otherwise their open HTTP responses
        // keep app.close() from ever resolving (heartbeat keeps them alive).
        await SSEFactory.shutdown()
        await app.close()
        // Write any debounced KV changes before exiting.
        getKvStore().close()
        logger.warn('Graceful shutdown complete')
        clearTimeout(forceExit)
        process.exit(0)
      } catch (error) {
        logger.error(`Error during graceful shutdown: ${error}`)
        clearTimeout(forceExit)
        process.exit(1)
      }
    })
  })
  process.on('uncaughtException', async (error) => {
    logger.error(`Uncaught Exception: ${error}`)
  })
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`)
  })
}
