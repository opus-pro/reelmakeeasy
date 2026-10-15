import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { isStoreKey } from '@reelmakeeasy/common/storage/address'
import {
  contentTypeFor,
  filePath,
  filesRoot,
  fileStore,
  verifyUploadSignature,
} from '@reelmakeeasy/common/storage/file-store'
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'

/**
 * The stored file's key from the route's wildcard: checked by the one parser's rules
 * (no empty, `.`/`..` or dot-led segment, no backslash, nothing still encoded), so
 * nothing outside the stored files -- the signing key, the run records, the sidecars --
 * can be named.
 */
function keyFrom(param: string | string[]): string {
  const key = Array.isArray(param) ? param.join('/') : param
  if (!key) throw new BadRequestException('Missing file key')
  if (!isStoreKey(key)) throw new BadRequestException('Invalid file key')
  return key
}

/**
 * Serves stored files at `/api/files/<key>` (with HTTP range support for video) and
 * accepts uploads to signed URLs minted by `StoredFile.signedUploadUrl()`.
 */
@Controller('files')
export class FilesController {
  @Get('*key')
  serve(
    @Param('key') keyParam: string | string[],
    @Query('download') downloadName: string | undefined,
    @Res() res: Response,
  ): void {
    const key = keyFrom(keyParam)
    const root = filesRoot()
    let file: string
    try {
      file = filePath(key)
    } catch {
      // A link out of the stored files: answered like a missing file.
      throw new NotFoundException('Not found')
    }
    // Relative to the files folder: sendFile hides any path with a dot segment, and
    // the data dir itself is `.reelmakeeasy`.
    // Stored files are replaced in place (a re-render writes the same
    // final_video.mp4), so browsers keep them but revalidate every use: a cheap
    // 304 locally, and never a stale video or thumbnail.
    const opts = { cacheControl: false, headers: serveHeaders(key, downloadName), root }
    res.sendFile(path.relative(root, file), opts, (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: 'Not found' })
    })
  }

  @Put('*key')
  async upload(
    @Param('key') keyParam: string | string[],
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = keyFrom(keyParam)
    if (!sig || !verifyUploadSignature({ expires: Number(expires), key, sig })) {
      throw new ForbiddenException('Invalid or expired upload URL')
    }
    const contentType = req.headers['content-type'] ?? contentTypeFor(key)
    await pipeline(req, fileStore.file(key).createWriteStream({ contentType }))
    res.status(200).end()
  }
}

/** Response headers for a stored file. */
export function serveHeaders(key: string, downloadName?: string): Record<string, string> {
  const contentType = contentTypeFor(key)
  return {
    'Cache-Control': 'no-cache',
    'Content-Type': contentType,
    // An SVG opened directly would run its scripts on the API origin, so it is
    // served sandboxed: no scripts, no requests, no sniffing.
    ...(contentType === 'image/svg+xml'
      ? {
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'X-Content-Type-Options': 'nosniff',
        }
      : {}),
    // `?download=<name>` saves the file instead of opening it (the video
    // download link): a link's `download` attribute is ignored cross-origin.
    ...(downloadName ? { 'Content-Disposition': attachmentDisposition(downloadName) } : {}),
  }
}

/** An attachment header that keeps a non-ASCII file name (RFC 6266 / RFC 5987). */
function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\u0020-\u007E]|["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
