import { Controller, Get, Param, Res } from '@nestjs/common'
import type { CaptionFontsResponse } from '@shared/types/api/caption-style'
import type { Response } from 'express'

import { CaptionFontsService } from './caption-fonts.service'

/**
 * The caption fonts a video can pick (`GET /api/caption-fonts`), and the render pack's faces as
 * `.ttf` files (`GET /api/caption-fonts/pack/<file>.ttf`), so the picker can draw each name in its
 * own font with the browser's FontFace. The editor engine never loads these: it loads the whole
 * render pack archive once.
 */
@Controller('caption-fonts')
export class CaptionFontsController {
  constructor(private readonly captionFonts: CaptionFontsService) {}

  @Get()
  list(): CaptionFontsResponse {
    return { data: { pack: this.captionFonts.listPack() } }
  }

  @Get('pack/:file')
  async servePack(@Param('file') file: string, @Res() res: Response): Promise<void> {
    // Only the pack families' face names, exactly: nothing else reaches a file path.
    const root = await this.captionFonts.packFontDir(file)
    if (!root) {
      res.status(404).json({ message: 'Not found' })
      return
    }
    res.sendFile(
      file,
      {
        headers: {
          'Content-Type': 'font/ttf',
          // The web app loads it from another port: let it, and only as the font it is.
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'X-Content-Type-Options': 'nosniff',
        },
        immutable: true,
        maxAge: '365d',
        root,
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).json({ message: 'Not found' })
      },
    )
  }
}
