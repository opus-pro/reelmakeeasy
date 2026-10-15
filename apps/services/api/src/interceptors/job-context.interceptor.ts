import { JobContext, SharedJobContext } from '@reelmakeeasy/common/job-context'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'

interface RequestWithUser {
  body?: Record<string, unknown>
  params?: Record<string, string>
  query?: Record<string, string>
  user?: { email?: string; sub?: string; user_id?: string }
}

/**
 * JobContext Interceptor
 *
 * Automatically injects projectId, userId, userEmail into JobContext for logging.
 * This ensures all logs within API request handlers include project context,
 * similar to how worker apps use wrapActivitiesWithContext().
 *
 * Context is extracted from:
 * - projectId: request params, body, or query
 * - userId/userEmail: request.user (set by AuthGuard)
 */
@Injectable()
export class JobContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>()

    // Extract projectId from params, body, or query (in order of precedence)
    const projectId =
      req.params?.['projectId'] ||
      (req.body?.['projectId'] as string | undefined) ||
      req.query?.['projectId']

    // Extract user info from requestCtx
    const userId = getReqContext().login_id
    // eslint-disable-next-line @nx/workspace-no-pii-field-access
    const userEmail = getReqContext().pii?.email

    // If no context info available, just proceed without wrapping
    if (!projectId && !userId) {
      return next.handle()
    }

    // Build context object (only include defined values)
    const jobCtx: Partial<SharedJobContext> = {}
    if (projectId) {
      jobCtx.projectId = projectId
    }
    if (userId) {
      jobCtx.userId = userId
    }
    if (userEmail) {
      jobCtx.userEmail = userEmail
    }

    // Wrap the entire Observable subscription in JobContext
    // AsyncLocalStorage context is preserved across async boundaries
    return new Observable((subscriber) => {
      // Return the teardown function from JobContext.run so RxJS can unsubscribe
      // and stop the inner stream when the client disconnects
      return JobContext.run(jobCtx as SharedJobContext, () => {
        const subscription = next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        })

        return () => subscription.unsubscribe()
      })
    })
  }
}
