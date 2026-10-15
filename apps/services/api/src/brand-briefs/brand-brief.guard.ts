import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common'

// The saved-brand feature (Branding V2) is off, so the whole management surface
// is hidden -- 404 (not 403) so we don't advertise the endpoint.
@Injectable()
export class BrandBriefGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ method?: string }>()
    if (req.method === 'OPTIONS') {
      return true
    }
    throw new NotFoundException()
  }
}
