import 'dotenv/config'

import type { InputJsonValue, JsonValue } from '@prisma/client/runtime/library'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

// generated code by running `nx run api/db:generate`
import { PrismaClient } from './generated/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Creates a configured PrismaClient instance for MongoDB.
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = globalForPrisma.prisma ?? createPrismaClient()
}

const DEFAULT_INSTANCE_KEY = 'default'
const instanceMap = new Map<string, PrismaClient>()
// instanceMap.set(DEFAULT_INSTANCE_KEY, prisma)

export function getPrismaInstance(opt?: { datasourceUrl?: string }): PrismaClient {
  const key = opt?.datasourceUrl ?? DEFAULT_INSTANCE_KEY
  if (instanceMap.has(key)) {
    return instanceMap.get(key) as PrismaClient
  }
  const instance = new PrismaClient({ datasourceUrl: opt?.datasourceUrl })
  instanceMap.set(key, instance)
  return instance
}

function collectPrismaClientsForShutdown(): PrismaClient[] {
  const seen = new Set<PrismaClient>()
  const clients: PrismaClient[] = []
  const add = (client: PrismaClient | undefined) => {
    if (client && !seen.has(client)) {
      seen.add(client)
      clients.push(client)
    }
  }
  add(globalForPrisma.prisma)
  for (const client of instanceMap.values()) {
    add(client)
  }
  return clients
}

async function disconnectAllPrismaClients(): Promise<void> {
  await Promise.allSettled(collectPrismaClientsForShutdown().map((client) => client.$disconnect()))
}

/**
 * Best-effort disconnect on process shutdown so MongoDB connections are not left hanging
 * (CLI scripts, workers, non-Nest entrypoints). Nest apps still use OnModuleDestroy as primary.
 * Skipped under Jest / Vitest so test workers are not affected.
 */
function registerPrismaProcessExitHooks(): void {
  if (process.env['JEST_WORKER_ID'] !== undefined || process.env['VITEST'] === 'true') {
    return
  }
  let disconnectStarted = false

  const onBeforeExit = (): void => {
    process.stdout.write(
      'registerPrismaProcessExitHooks.onBeforeExit(): disconnectAllPrismaClients\n',
    )
    if (disconnectStarted) {
      return
    }
    disconnectStarted = true
    void disconnectAllPrismaClients()
  }

  /** SIGINT/SIGTERM listeners replace Node's default exit; re-raise after disconnect so the process always terminates. */
  const onSignal = (signal: NodeJS.Signals): void => {
    process.stdout.write(
      `registerPrismaProcessExitHooks.onSignal(${signal}): disconnectAllPrismaClients\n`,
    )
    if (disconnectStarted) {
      process.kill(process.pid, signal)
      return
    }
    disconnectStarted = true
    void disconnectAllPrismaClients().finally(() => {
      process.kill(process.pid, signal)
    })
  }

  process.once('beforeExit', onBeforeExit)
  process.once('SIGINT', () => onSignal('SIGINT'))
  process.once('SIGTERM', () => onSignal('SIGTERM'))
}

registerPrismaProcessExitHooks()

export * from './generated/client'
export * from './generated/enums'
export type { InputJsonValue, JsonValue, PrismaClient }

// for nestjs usage only, use getPrismaInstance() instead
export { PrismaClient as DONT_INITIATE_PRISMA_CLIENT, PrismaClientKnownRequestError }
