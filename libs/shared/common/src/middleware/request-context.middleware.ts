import { Injectable, NestMiddleware } from '@nestjs/common'
import { ReqContext } from '@shared/types/api/req-ctx'
import { NextFunction, Request, Response } from 'express'

import {
  LOCAL_LOGIN_ID,
  LOCAL_ORG_ID,
  LOCAL_USER_EMAIL,
  LOCAL_USER_ID,
} from '../auth/local-identity'
import { runWithContext } from '../utils/req-ctx'

/**
 * Binds every request to the single local identity. The API has no access
 * control: anyone who can reach it acts as the local user.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const ctx: ReqContext = {
      login_id: LOCAL_LOGIN_ID,
      org_id: LOCAL_ORG_ID,
      pii: { email: LOCAL_USER_EMAIL, ip: req.ip ?? '' },
      user_id: LOCAL_USER_ID,
    }
    runWithContext(ctx, () => next())
  }
}
