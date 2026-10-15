import { z } from 'zod'

export const SharedSceneJobContextSchema = z.object({
  sceneId: z.string().optional(),
  shotId: z.string().optional(),
})

export const PipelineContextEntrySchema = z.object({
  name: z.string(),
  value: z.string(),
})

export type PipelineContextEntry = z.infer<typeof PipelineContextEntrySchema>

export const SharedJobContextSchema = SharedSceneJobContextSchema.extend({
  activityName: z.string().optional(),
  workflowId: z.string().optional(),

  // Basic identity fields
  projectId: z.string().optional(),
  userId: z.string().optional(),
  userEmail: z.string().optional(),
  projectTier: z.string().optional(),

  // Workflow-scoped context fields
  conversationId: z.string().optional(),
  modelSwitch: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  // The AI an LLM call is pinned to, ahead of its agent-mode project and the AI chosen in
  // Setup (audio calls pin 'gemini' on Codex and Claude Code, which can't hear audio).
  llmProvider: z.enum(['claude', 'codex', 'endpoint', 'gemini']).optional(),

  // sandboxId: Used by eval framework to ensure consistent local cache paths
  // Format: ${runId}_${testCase.id}_${generator.id}
  // When present, local scratch paths are kept apart per sandbox
  sandboxId: z.string().optional(),
  evalMode: z.boolean().optional(),
  aoProjectEnv: z.enum(['dev', 'local', 'prod', 'stg']).optional().describe('Project environment'),

  // Pipeline context: ordered key-value pairs accumulated through pipeline stages
  pipelineContext: z.array(PipelineContextEntrySchema).optional(),

  // TTS chunk context: set per voiceover chunk so the logger mixin tags
  // each chunk's language decision / produced-language lines with its index, making
  // them attributable per chunk even though chunks generate in parallel.
  ttsChunkCount: z.number().optional(),
  ttsChunkIndex: z.number().optional(),
})

export type SharedJobContext = z.infer<typeof SharedJobContextSchema>
export type SharedSceneJobContext = z.infer<typeof SharedSceneJobContextSchema>
