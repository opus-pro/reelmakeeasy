import { KvModule } from '@reelmakeeasy/common/kv'
import { RequestContextMiddleware } from '@reelmakeeasy/common/middleware/request-context.middleware'
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'

import { AgentModule } from './agent/agent.module'
import { AssetsModule } from './assets/assets.module'
import { BrandBriefModule } from './brand-briefs/brand-brief.module'
import { CaptionFontsModule } from './caption-fonts/caption-fonts.module'
import { FilesModule } from './files/files.module'
import { HealthModule } from './health/health.module'
import { HistoryModule } from './history/history.module'
import { ImageModelsModule } from './image-models/image-models.module'
import { JobContextInterceptor } from './interceptors/job-context.interceptor'
import { ServedUrlsInterceptor } from './interceptors/served-urls.interceptor'
import { TraceInterceptor } from './interceptors/trace.interceptor'
import { LongTakeModule } from './long-take/long-take.module'
import { MediaModule } from './media/media.module'
import { ModelsModule } from './models/models.module'
import { MusicModule } from './music/music.module'
import { PresetsModule } from './presets/presets.module'
import { PrismaModule } from './prisma/prisma.module'
import { ProjectsSceneModule } from './project-scene/projectScene.module'
import { ProjectsModule } from './projects/projects.module'
import { SetupModule } from './setup/setup.module'
import { SpeechModule } from './speech/speech.module'
import { SharedModule } from './shared/shared.module'
import { RankingModule } from './ranking/ranking.module'
import { SoundLibraryModule } from './sound-library/sound-library.module'
import { SourcePreferencesModule } from './source-preferences/source-preferences.module'
import { StyleManagementModule } from './style-management/style-management.module'
import { UipModule } from './uip/uip.module'
import { UserSavedStylesModule } from './user-saved-styles/user-saved-styles.module'
import { VoiceClonesModule } from './voice-clones/voice-clones.module'
import { VoiceOverModule } from './voice-over/voice-over.module'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AgentModule,
    EventEmitterModule.forRoot(),
    PrismaModule,
    HistoryModule,
    ProjectsModule,
    MediaModule,
    MusicModule,
    BrandBriefModule,
    AssetsModule,
    UserSavedStylesModule,
    VoiceClonesModule,
    VoiceOverModule,
    ProjectsSceneModule,
    SharedModule,
    StyleManagementModule,
    SourcePreferencesModule,
    KvModule.forRoot(),
    FilesModule,
    PresetsModule,
    HealthModule,
    SetupModule,
    SpeechModule,
    LongTakeModule,
    UipModule,
    ImageModelsModule,
    ModelsModule,
    CaptionFontsModule,
    RankingModule,
    SoundLibraryModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: JobContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TraceInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ServedUrlsInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // path-to-regexp v6: use named wildcard parameters (e.g. *path) instead of '*'
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL })
  }
}
