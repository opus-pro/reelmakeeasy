import { serveStoredUrls } from '@reelmakeeasy/common/storage/address'
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { map, Observable } from 'rxjs'

/**
 * Saved records hold `store://` addresses only, never a host or port. This builds the
 * served URL of every address in a URL field (`resultVideo`, `thumbnailUrl`, `cdnUrl`, ...)
 * as a response leaves for the browser, against this API's own files route.
 */
@Injectable()
export class ServedUrlsInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body: unknown) => serveStoredUrls(body)))
  }
}
