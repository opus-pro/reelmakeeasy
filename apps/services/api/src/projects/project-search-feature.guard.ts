import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

export const PROJECT_SEARCH_LOCAL_OVERRIDE_ENV = 'PROJECT_SEARCH_LOCAL_OVERRIDE'

@Injectable()
export class ProjectSearchFeatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      method?: string
      searchEnabled?: boolean
    }>()
    if (req.method === 'OPTIONS') {
      return true
    }
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env[PROJECT_SEARCH_LOCAL_OVERRIDE_ENV] === '1'
    ) {
      req.searchEnabled = true
      return true
    }
    // Project search is off outside the local dev override.
    req.searchEnabled = false
    return true
  }
}
