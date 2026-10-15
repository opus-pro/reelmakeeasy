import { KvModule } from '@reelmakeeasy/common/kv'
import { Module } from '@nestjs/common'

import { ScheduledJobRegistryService } from './scheduled-job-registry.service'

@Module({
  imports: [KvModule],
  providers: [ScheduledJobRegistryService],
  exports: [ScheduledJobRegistryService],
})
export class ScheduledJobModule {}
