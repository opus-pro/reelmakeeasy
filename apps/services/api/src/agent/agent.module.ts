import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  setChatEndpointPreference,
  setChatTransportResolver,
  setCurrentLlmProvider,
} from '@reelmakeeasy/llm'
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import type { LlmProvider } from '@shared/types/api/setup'

import { LongTakeModule } from '../long-take/long-take.module'
import { LongTakeService } from '../long-take/long-take.service'
import { MusicModule } from '../music/music.module'
import { MusicService } from '../music/music.service'
import { ProjectsModule } from '../projects/projects.module'
import { ProjectService } from '../projects/projects.service'
import { SetupModule } from '../setup/setup.module'
import { SetupSettingsService } from '../setup/setup-settings.service'

import { AutonomousService } from './autonomous/autonomous.service'
import { ClaudeLlmService } from './claude/claude-llm.service'
import { CodexLlmService } from './codex-llm/codex-llm.service'
import {
  AgentProjects,
  makeChatEndpointPreference,
  makeLlmResolver,
} from './codex-llm/codex-projects'
import { AgentEditService } from './edit/agent-edit.service'
import { RankingModule } from '../ranking/ranking.module'
import { RankingAgentTools } from '../ranking/ranking-agent-tools'
import { RankingTemplateService } from '../ranking/ranking-template.service'
import { LibraryPrints } from '../ranking/reference/library-prints'
import { RankingService } from '../ranking/ranking.service'
import { SoundLibraryModule } from '../sound-library/sound-library.module'
import { SoundLibraryService } from '../sound-library/sound-library.service'

import { AgentController } from './agent.controller'
import { AgentSessionService } from './agent-session.service'
import { ChatModelService } from './chat-model.service'

@Module({
  controllers: [AgentController],
  imports: [LongTakeModule, ProjectsModule, MusicModule, SetupModule, RankingModule, SoundLibraryModule],
  providers: [
    // The models agent chats can run on (asked of each harness, kept for a while).
    { provide: ChatModelService, useFactory: () => new ChatModelService() },
    {
      inject: [ModuleRef, ChatModelService, RankingService, SoundLibraryService, RankingTemplateService],
      provide: AgentSessionService,
      // The autonomous flow needs the session service and the session service starts the flow:
      // resolve the flow lazily, when a session first picks that mode.
      useFactory: (
        refs: ModuleRef,
        chatModels: ChatModelService,
        ranking: RankingService,
        sounds: SoundLibraryService,
        templates: RankingTemplateService,
      ) => {
        const flow = () => refs.get(AutonomousService, { strict: true })
        const edit = () => refs.get(AgentEditService, { strict: true })
        // The Ranking Builder's tools; the session service gives the chat's working folder.
        let session: AgentSessionService | undefined
        const rankingTools = new RankingAgentTools({
          onRanking: (id, rankingId) => session?.followRanking(id, rankingId),
          prints: new LibraryPrints(sounds),
          ranking,
          sounds,
          templates,
          workingDir: (id) => (session as AgentSessionService).workingDir(id),
        })
        session = new AgentSessionService({
          autonomous: {
            cancel: (id) => flow().cancel(id),
            resume: (id) => flow().resume(id),
            resumeAction: (id) => flow().resumeAction(id),
            start: (id) => flow().start(id),
          },
          chatModels,
          // Codex's ReelMakeEasy tools, answered by the edit service (resolved lazily, like the
          // flow); the Ranking Builder's by its own tools.
          onToolCall: (id, tool, args) =>
            tool.startsWith('ranking_') ? rankingTools.call(id, tool, args) : edit().callTool(id, tool, args),
        })
        return session
      },
    },
    {
      inject: [AgentSessionService, AgentProjects, LongTakeService, ProjectService, MusicService],
      provide: AutonomousService,
      useFactory: (
        sessions: AgentSessionService,
        agentProjects: AgentProjects,
        longTake: LongTakeService,
        projects: ProjectService,
        music: MusicService,
      ) => new AutonomousService({ agentProjects, longTake, music, projects, sessions }),
    },
    {
      inject: [
        AgentSessionService,
        LongTakeService,
        ProjectService,
        AutonomousService,
        MusicService,
      ],
      provide: AgentEditService,
      useFactory: (
        sessions: AgentSessionService,
        longTake: LongTakeService,
        projects: ProjectService,
        autonomous: AutonomousService,
        music: MusicService,
      ) => new AgentEditService({ autonomous, longTake, music, projects, sessions }),
    },
    CodexLlmService,
    ClaudeLlmService,
    { provide: AgentProjects, useFactory: () => new AgentProjects() },
  ],
})
export class AgentModule implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(AgentModule.name)

  constructor(
    private readonly codexLlm: CodexLlmService,
    private readonly claudeLlm: ClaudeLlmService,
    private readonly agentProjects: AgentProjects,
    private readonly sessions: AgentSessionService,
    private readonly projects: ProjectService,
    private readonly setup: SetupSettingsService,
  ) {}

  onModuleDestroy(): void {
    setChatTransportResolver(null)
    setChatEndpointPreference(null)
    setCurrentLlmProvider(null)
  }

  /** Every pipeline LLM call runs on the AI chosen in Setup (Codex, Claude Code, Gemini or a
   *  custom endpoint), except a call pinned to one (audio calls pin Gemini on Codex and Claude
   *  Code) and an agent-mode project's calls, which run on the harness whose chat made it. */
  onModuleInit(): void {
    const currentLlm = (): LlmProvider | null => this.setup.currentLlm()
    setChatTransportResolver(
      makeLlmResolver({
        currentLlm,
        notSetUpMessage: () => this.setup.llmNotSetUpMessage(),
        projects: this.agentProjects,
        transports: { claude: this.claudeLlm.transport, codex: this.codexLlm.transport },
      }),
    )
    setChatEndpointPreference(makeChatEndpointPreference(currentLlm))
    setCurrentLlmProvider(currentLlm)
    // Projects made in agent mode before `createdVia` / `agentSessionId` existed. Never blocks
    // or fails startup.
    void this.fillAgentProjects().catch((error: unknown) =>
      this.logger.warn(`Agent project fill failed: ${ensureError(error).message}`),
    )
  }

  private async fillAgentProjects(): Promise<void> {
    const sessionByProject = new Map<string, string>()
    for (const s of this.sessions.listSessions()) {
      if (s.projectId) sessionByProject.set(s.projectId, s.id)
    }
    const changed = await this.projects.fillAgentFields({
      agentProjectIds: this.agentProjects.all(),
      sessionByProject,
    })
    if (changed) this.logger.log(`Linked ${changed} agent project field(s) to their chats`)
  }
}
