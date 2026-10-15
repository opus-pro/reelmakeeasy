// Load .env from the repo root before anything reads configuration.
import 'dotenv/config'

import path from 'node:path'

import { setChunkSink } from '@reelmakeeasy/common/agent-v2/util/push-chunks'
import { initKvStore } from '@reelmakeeasy/common/kv'
import { initLLM } from '@reelmakeeasy/common/llm'
import { Logger, logger } from '@reelmakeeasy/common/logger'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import { initTracer } from '@reelmakeeasy/common/tracer'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { startRenderWorker } from '@reelmakeeasy/render-worker'
import { startStoryModeWorkers } from '@reelmakeeasy/story-mode-workers'
import { configureEngine, takeInterruptedRuns } from '@reelmakeeasy/workflow-engine/worker'
import { NestFactory } from '@nestjs/core'
import { json, type NextFunction, type Request, type Response } from 'express'

import { PrismaService } from './prisma/prisma.service'
import { getSwaggerEnabled, setupSwagger } from './swagger/swagger-setup'
import { createChunkSink } from './workflow-runs/chunk-sink'
import { failInterruptedRuns } from './workflow-runs/interrupted-runs'
import { AppModule } from './app.module'
import setCors from './cors'
import { gracefulShutdown } from './graceful-shutdown'

async function bootstrap() {
  const serviceName = 'agent-api'
  initTracer({ serviceName })

  // Load persisted state (finished runs' status) before anything reads it.
  const kv = initKvStore({ file: path.join(dataDir(), 'kv.json') })
  SSEFactory.init(serviceName)
  initLLM({ serviceName, biz: 'ReelMakeEasy' })
  // Workflows run in this process, so the workers register alongside the API.
  // Read the previous process's journal before any new run can overwrite it.
  configureEngine({ journalPath: path.join(dataDir(), 'workflow-runs.json') })
  const interruptedRuns = takeInterruptedRuns()
  await startStoryModeWorkers()
  await startRenderWorker()
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new Logger('api'),
  })
  const prisma = app.get(PrismaService)
  // Workflows report status and project patches straight to the API process.
  setChunkSink(createChunkSink({ kv, prisma }))
  await failInterruptedRuns(prisma, interruptedRuns)
  const globalPrefix = 'api'
  app.setGlobalPrefix(globalPrefix)

  app.use(json({ limit: '10mb' }))
  // The web app's editor pages are cross-origin isolated (COEP require-corp), so
  // they only load media from this origin when it opts in to being embedded.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    next()
  })

  setCors(app)
  if (getSwaggerEnabled()) {
    setupSwagger(app)
  }
  gracefulShutdown(app)

  const port = process.env.PORT || 5017
  // The API has no access control, so it answers this computer only unless HOST opts in
  // (HOST=0.0.0.0 listens on every interface).
  const host = process.env.HOST || '127.0.0.1'

  try {
    await app.listen(port, host)
    logger.info(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`)
  } catch (e) {
    const error = ensureError<NodeJS.ErrnoException>(e)
    if (error.code === 'EADDRINUSE') {
      logger.error(
        `Port ${port} is already in use. Please try a different port or kill the process using this port.`,
      )
      process.exit(1)
    } else {
      logger.error(`Failed to start server: ${error}`)
      process.exit(1)
    }
  }
}

bootstrap()
