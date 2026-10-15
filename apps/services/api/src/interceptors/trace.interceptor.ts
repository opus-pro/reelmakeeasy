import { logger } from '@reelmakeeasy/common/logger'
import { getFullTraceId } from '@reelmakeeasy/common/tracer'
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse()
    try {
      const traceId = getFullTraceId()
      if (traceId && !res.headersSent) {
        // Express:
        if (typeof res.setHeader === 'function') {
          res.setHeader('x-reelmakeeasy-trace-id', traceId)
        }
        // Fastify:
        else if (typeof res.header === 'function') {
          res.header('x-reelmakeeasy-trace-id', traceId)
        }
      }
    } catch (err) {
      logger.warn('TraceInterceptor pre-set header error: %o', err)
    }
    return next.handle()
  }
}
