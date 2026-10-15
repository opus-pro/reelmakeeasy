import { contentTypeFor } from '@reelmakeeasy/common/storage/file-store'
import { resolvePresetKey } from '@reelmakeeasy/common/storage/presets'
import { BadRequestException, Controller, Get, Param, Res } from '@nestjs/common'
import type { Response } from 'express'

/**
 * Serves bundled static files: `/api/presets/<pack version>/...` from the
 * installed preset pack (cached for good, a new pack gets a new version), and
 * everything else from the repo's `presets/` folder.
 */
@Controller('presets')
export class PresetsController {
  @Get('*key')
  serve(@Param('key') keyParam: string | string[], @Res() res: Response): void {
    const key = Array.isArray(keyParam) ? keyParam.join('/') : keyParam
    let resolved: ReturnType<typeof resolvePresetKey>
    try {
      resolved = resolvePresetKey(key)
    } catch {
      throw new BadRequestException('Invalid preset path')
    }
    res.sendFile(
      resolved.file,
      {
        headers: { 'Content-Type': contentTypeFor(key) },
        root: resolved.root,
        ...(resolved.immutable ? { immutable: true, maxAge: '365d' } : { maxAge: '1h' }),
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).json({ message: 'Not found' })
      },
    )
  }
}
