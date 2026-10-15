import { Injectable } from '@nestjs/common'
import { Logger } from '@reelmakeeasy/common/logger'
import type { SSEBus } from '@reelmakeeasy/common/sse/sse'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type { Client } from '@reelmakeeasy/workflow-engine/client'

import { PrismaService } from '../prisma/prisma.service'

import {
  assembleBrandBank,
  persistCreatedBrandBrief,
} from './brand-brief-create'
import { BRAND_BRIEF_STYLE_SLOTS } from './brand-brief-limits'
import { BrandBriefStyleGenerationService } from './brand-brief-style-generation.service'

// Local mirror of the BrandExtractionWorkflow contract. The api scope may not
// import `@reelmakeeasy/story-mode-runtime` (eslint module boundary), so the workflow is
// started by its registered string name and its result is typed here. Keep in
// sync with libs/story-mode-runtime/.../brand-extraction/types.ts.
const BRAND_EXTRACTION_WORKFLOW = 'BrandExtractionWorkflow'
const BRAND_EXTRACTION_BASE_QUEUE = 'brand-extraction'
const BRAND_EXTRACTION_RUN_TIMEOUT = '20 minutes'

export type CreateBrandInput = { kind: 'freeform'; text: string } | { kind: 'url'; url: string }

interface BrandExtractionResult {
  assetDescriptions?: unknown[]
  bankWithoutAssets?: Parameters<typeof assembleBrandBank>[0]['bankWithoutAssets']
  failureReason?: string
  outcome: 'completed' | 'failed'
  stagedAssetCandidates?: Parameters<typeof assembleBrandBank>[0]['stagedAssetCandidates']
}

// Spec error copy. Surfaced verbatim to the FE so it can offer the
// manual-input fallback / a retry.
const URL_EXTRACTION_FAILED_COPY =
  "We couldn't extract brand info from this URL. Try a different URL or enter your brand info manually."
const FREEFORM_EXTRACTION_FAILED_COPY =
  "We couldn't build a brand from that description. Please edit it and try again."
const STYLE_GEN_FAILED_COPY = 'Style generation failed. Please try again.'

/**
 * Orchestrates standalone create-brand-in-library: run the existing brand-
 * extraction workflow as a top-level (parent-less) invocation, save the brief,
 * then auto-generate a brand style in the background, streaming progress + live
 * previews over the SSE bus. Style generation is quota-exempt (brand context).
 *
 * The style text comes from the website-style synthesis when the run has a
 * crawl scrape: `generateBrandStyleFromWebsite` reads the site's page copy +
 * design tokens -- the pipeline the designer validated. A missing scrape or a
 * synthesis failure falls back to the previous chain, `generateBrandStyling`
 * over the bank's text + palette. Either way the text is then formalized by
 * `analyzeStyle`. Only URL brands get a style: freeform input has no website
 * to ground one, so style gen is skipped (as it is when the brief's plan style
 * slots are full).
 */
@Injectable()
export class BrandBriefCreateService {
  private readonly logger = new Logger(BrandBriefCreateService.name)
  private workflowClient: Client | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly styleGeneration: BrandBriefStyleGenerationService,
  ) {}

  /**
   * Drive one create-brand run end to end over the SSE bus. Throws only on an
   * unexpected error (the caller's safeRun turns that into an SSE `error`);
   * expected terminal states (extraction failed, style skipped/failed) are
   * emitted as typed events and the stream ends cleanly.
   */
  async runCreate(
    args: {
      images?: string[]
      input: CreateBrandInput
      orgId: string
      userId: string
    },
    bus: SSEBus,
  ): Promise<void> {
    const { images, input, orgId, userId } = args
    const runId = `${orgId}-${userId}-${Date.now()}`
    const projectId = `brand-create-${runId}`

    const failExtraction = async (reason: string) => {
      const message =
        input.kind === 'url' ? URL_EXTRACTION_FAILED_COPY : FREEFORM_EXTRACTION_FAILED_COPY
      await bus.push({ data: JSON.stringify({ message, reason }), type: 'extraction_failed' })
      await bus.end()
    }

    await bus.push({ data: JSON.stringify({ phase: 'extracting' }), type: 'status' })
    const result = await this.runBrandExtraction({ input, projectId, runId, userId })
    if (result.outcome !== 'completed' || !result.bankWithoutAssets) {
      await failExtraction(result.failureReason ?? 'internal_error')
      return
    }

    // assembleBrandBank validates the synthesized bank + the user-supplied
    // reference-image URIs against the schema and throws on a mismatch. Degrade
    // to the manual-input fallback rather than surfacing a raw stream error.
    let bank: ReturnType<typeof assembleBrandBank>
    try {
      bank = assembleBrandBank(result, input.kind === 'url' ? [] : (images ?? []))
    } catch (error) {
      this.logger.warn(
        `[${projectId}] failed to assemble brand bank: ${ensureError(error).message}`,
      )
      await failExtraction('bank_assembly_failed')
      return
    }
    const sourceUrl = input.kind === 'url' ? input.url : null
    const persisted = await persistCreatedBrandBrief(this.prisma, {
      bank,
      // Fallback name source for an unnamed synthesis; URL creates
      // derive from the domain instead.
      freeformText: input.kind === 'freeform' ? input.text : null,
      orgId,
      sourceProjectId: projectId,
      sourceUrl,
      userId,
    })
    if (persisted.result !== 'saved' || !persisted.briefId) {
      await bus.push({ data: JSON.stringify({ reason: persisted.result }), type: 'brief_skipped' })
      await bus.end()
      return
    }
    const briefId = persisted.briefId
    await bus.push({ data: JSON.stringify({ briefId }), type: 'brief' })

    // Freeform brands never get an auto-generated style; only URL creates do.
    if (input.kind !== 'url') {
      await bus.push({ data: JSON.stringify({ reason: 'freeform_input' }), type: 'style_skipped' })
      await bus.end()
      return
    }

    // The other pre-flight skip: the brief's style slots are full.
    if (persisted.styleSlotsUsed >= BRAND_BRIEF_STYLE_SLOTS) {
      await bus.push({ data: JSON.stringify({ reason: 'slots_full' }), type: 'style_skipped' })
      await bus.end()
      return
    }

    await bus.push({ data: JSON.stringify({ phase: 'generating_style' }), type: 'status' })
    await this.generateStyle({
      bank,
      briefId,
      bus,
      orgId,
      projectId,
      runId,
      sourceUrl,
      userId,
    })
    await bus.end()
  }

  /**
   * Generate a brand style and attach it to the brief (shared orchestration in
   * BrandBriefStyleGenerationService), streaming previews over the bus.
   * A style-gen failure is
   * non-fatal -- the brief stays saved -- so it surfaces as `style_error`
   * rather than failing the stream.
   */
  private async generateStyle(args: {
    bank: ReturnType<typeof assembleBrandBank>
    briefId: string
    bus: SSEBus
    orgId: string
    projectId: string
    runId: string
    sourceUrl: null | string
    userId: string
  }): Promise<void> {
    const { bank, briefId, bus, orgId, projectId, runId, sourceUrl, userId } = args
    try {
      await this.styleGeneration.generateAndAttach({
        bank,
        briefId,
        extractionRunId: runId,
        // The generated style is the created brief's only style, so it is the
        // default.
        isDefault: true,
        onSample: (sample) => bus.push({ data: JSON.stringify(sample), type: 'sample' }),
        orgId,
        projectId,
        sourceUrl,
        userId,
      })
      await bus.push({ data: JSON.stringify({ briefId }), type: 'style_complete' })
    } catch (error) {
      this.logger.warn(`[${briefId}] brand style generation failed: ${ensureError(error).message}`)
      await bus.push({
        data: JSON.stringify({ message: STYLE_GEN_FAILED_COPY }),
        type: 'style_error',
      })
    }
  }

  private async getWorkflowClient(): Promise<Client> {
    if (!this.workflowClient) {
      this.workflowClient = await createClient()
    }
    return this.workflowClient
  }

  /** Start the brand-extraction workflow top-level and await its result. */
  private async runBrandExtraction(args: {
    input: CreateBrandInput
    projectId: string
    runId: string
    userId: string
  }): Promise<BrandExtractionResult> {
    const client = await this.getWorkflowClient()
    const taskQueue = await resolveTaskQueueForClient(BRAND_EXTRACTION_BASE_QUEUE)
    const handle = await client.workflow.start(BRAND_EXTRACTION_WORKFLOW, {
      args: [
        {
          input: args.input,
          // No parent: the workflow's ready/failed signal is swallowed when the
          // parent is absent; we read the result inline instead.
          parentWorkflowId: `brand-create-parent-${args.runId}`,
          projectId: args.projectId,
          runId: args.runId,
          userId: args.userId,
        },
      ],
      taskQueue,
      workflowId: `ao:${args.projectId}:brand-extract:${args.runId}`,
      workflowRunTimeout: BRAND_EXTRACTION_RUN_TIMEOUT,
    })
    return (await handle.result()) as BrandExtractionResult
  }
}
