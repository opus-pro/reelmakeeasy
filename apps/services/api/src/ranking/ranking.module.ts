import { Module } from '@nestjs/common'

import { RankingController } from './ranking.controller'
import { RankingService } from './ranking.service'

@Module({
  controllers: [RankingController],
  providers: [{ provide: RankingService, useFactory: () => new RankingService() }],
})
export class RankingModule {}
