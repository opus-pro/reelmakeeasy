import { Module } from '@nestjs/common'

import { CaptionFontsController } from './caption-fonts.controller'
import { CaptionFontsService } from './caption-fonts.service'

@Module({
  controllers: [CaptionFontsController],
  exports: [CaptionFontsService],
  providers: [CaptionFontsService],
})
export class CaptionFontsModule {}
