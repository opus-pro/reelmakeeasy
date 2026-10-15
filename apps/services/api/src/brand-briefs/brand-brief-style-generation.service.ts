import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type BrandBank,
  generateBrandStyleFromWebsite,
  generateBrandStyling,
} from '@reelmakeeasy/uip-planner-runtime'
import { Injectable } from '@nestjs/common'

import {
  type ColorPalette,
  type SceneSampleResult,
  StyleAnalyzerService,
} from '../media/style-analyzer.service'
import { PrismaService } from '../prisma/prisma.service'
import { UserSavedStylesService } from '../user-saved-styles/user-saved-styles.service'

import {
  attachStyleRefToBrief,
  materializeBrandStyleRef,
  readBrandCrawlScrape,
} from './brand-brief-create'
import { BRAND_BRIEF_STYLE_SLOTS } from './brand-brief-limits'

export interface GenerateBrandStyleArgs {
  bank: BrandBank
  briefId: string
  // Crawl run id of the brand extraction; keys the staged scrape read. Null
  // (no run) degrades to the bank-text synthesis fallback.
  extractionRunId: null | string
  // false attaches the generated style without the default flag, so the
  // brief's existing default (e.g. the video style saved at confirm) stands.
  isDefault: boolean
  onSample?: (sample: SceneSampleResult) => Promise<void>
  orgId: string
  projectId: string
  sourceUrl: null | string
  userId: string
}

// Outcome of the confirm-save trigger; 'started' means the generation is now
// running in the background (fire-and-forget).
export type ConfirmStyleGenerationStart =
  | 'skipped_already_generated'
  | 'skipped_slots_full'
  | 'started'

/**
 * Brand-style generation shared by the standalone create-in-library flow and
 * the UIP confirm-save path: synthesize style text (website scrape when
 * available, bank text otherwise), formalize it via analyzeStyle, render the
 * scene samples, materialize a library custom style, and attach it to the
 * brief. Quota-exempt (brand context: skipQuota).
 */
@Injectable()
export class BrandBriefStyleGenerationService {
  private readonly logger = new Logger(BrandBriefStyleGenerationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly styleAnalyzer: StyleAnalyzerService,
    private readonly userSavedStyles: UserSavedStylesService,
  ) {}

  /**
   * Run one generation end to end and attach the result to the brief. Throws
   * on failure, so callers only decide how to surface the error (SSE event vs
   * background log).
   */
  async generateAndAttach(args: GenerateBrandStyleArgs): Promise<void> {
    const { bank, briefId, isDefault, onSample, orgId, userId } = args
    const styleDescription = await this.synthesizeStyleText(args)
    const analysis = await this.styleAnalyzer.analyzeStyle({ styleDescription })
    const palette: ColorPalette = analysis.colorPalette
    const samples = await this.styleAnalyzer.generateSceneSamples(
      { palette, reusableStylePrompt: analysis.reusableStylePrompt, userId },
      onSample,
    )
    const styleRef = await materializeBrandStyleRef(this.prisma, this.userSavedStyles, {
      // Each generation belongs to one brief, so it gets its own library
      // style -- never dedupe onto a same-named brand's row.
      alwaysCreate: true,
      brandName: bank.basic_info.business_name ?? '',
      // Persist the just-rendered samples as the style's initial snapshot:
      // without it the style lands snapshot-less and the editor
      // re-renders all 3 previews (and replaces the thumbnail) on first open.
      scenePreviews: samples.map((s) => ({ archetypeId: s.archetypeId, imageUrl: s.imageUrl })),
      styleMetadata: {
        analysis: analysis.analysis,
        colorPalette: analysis.colorPalette,
        faceDepiction: analysis.faceDepiction,
        summary: analysis.summary,
      },
      styleText: analysis.reusableStylePrompt,
      thumbnailUrl: samples[0]?.imageUrl,
      userId,
    })
    if (styleRef) {
      await attachStyleRefToBrief(this.prisma, briefId, orgId, { isDefault, styleRef })
    }
  }

  /**
   * Confirm-save trigger: after a UIP confirm persisted the brief, generate a
   * website-derived style for it in the background. Cheap guards run inline
   * (style slots, one-generation-per-brief dedupe) and the pending marker is
   * stamped before returning; the generation itself is fire-and-forget, with
   * the marker cleared when it settles either way.
   */
  async maybeStartForSavedBrief(args: {
    bank: BrandBank
    briefId: string
    extractionRunId: null | string
    orgId: string
    projectId: string
    sourceUrl: null | string
    styles: unknown[]
    userId: string
  }): Promise<ConfirmStyleGenerationStart> {
    const { briefId, orgId, styles } = args
    if (styles.length >= BRAND_BRIEF_STYLE_SLOTS) {
      return 'skipped_slots_full'
    }
    if (styles.some((s) => (s as null | { origin?: string })?.origin === 'brand_generated')) {
      return 'skipped_already_generated'
    }
    await this.setPendingMarker(briefId, orgId, new Date())
    const run = async () => {
      try {
        // Non-default: the video style saved at confirm stays the default.
        await this.generateAndAttach({ ...args, isDefault: false })
      } finally {
        await this.setPendingMarker(briefId, orgId, null)
      }
    }
    void run().catch((error) => {
      this.logger.warn(
        `[${briefId}] confirm-save brand style generation failed: ${ensureError(error).message}`,
      )
    })
    return 'started'
  }

  private async setPendingMarker(briefId: string, orgId: string, at: Date | null): Promise<void> {
    await this.prisma.brandBrief.updateMany({
      data: { styleGenerationPendingAt: at },
      where: { id: briefId, orgId },
    })
  }

  /**
   * Produce the style text that feeds the `analyzeStyle` formalizer.
   *
   * URL brands: the website-style synthesis (`generateBrandStyleFromWebsite`)
   * over the crawl's raw scrape -- page copy + computed design tokens. No
   * screenshots: the crawl's top-fold captures add web-chrome noise, and the
   * extraction prompt is built to work from text + tokens.
   *
   * Fallback (missing scrape or a synthesis failure): the previous chain --
   * one `generateBrandStyling` call over the bank's text + palette.
   */
  private async synthesizeStyleText(args: {
    bank: BrandBank
    extractionRunId: null | string
    projectId: string
    sourceUrl: null | string
  }): Promise<string> {
    const { bank, extractionRunId, projectId, sourceUrl } = args
    if (sourceUrl) {
      const scrape = extractionRunId ? await readBrandCrawlScrape(projectId, extractionRunId) : null
      if (scrape) {
        const styleText = await generateBrandStyleFromWebsite({ scrape, url: sourceUrl })
        if (styleText) {
          this.logger.log(`[${projectId}] style text from website synthesis`)
          return styleText
        }
      }
      // Distinguish the two fallback causes in the log: a missing/unreadable
      // scrape (path drift, storage perms) vs a failed synthesis call.
      this.logger.warn(
        `[${projectId}] website style synthesis unavailable (${scrape ? 'synthesis_call_failed' : 'scrape_unreadable'}); falling back to bank-text synthesis`,
      )
    }
    const styling = await generateBrandStyling({ brandBank: bank, userStyleText: '' })
    const styleDescription = styling?.brand_style_paragraph?.trim()
    if (!styleDescription) {
      throw new Error('brand style synthesis returned no style text')
    }
    return styleDescription
  }
}
