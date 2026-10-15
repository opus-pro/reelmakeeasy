// Do NOT import from workflow.ts
//
// UIP V2 pasted-URL router: decides whether the URL in the user's
// message reads as an ARTICLE (news / blog post / tweet / editorial piece --
// the user wants the CONTENT turned into a video) or a BRAND site (a company /
// product website -- the user is promoting the business). The workflow routes
// the article door vs brand extraction on the verdict; below the confidence
// floor it suppresses both and the director asks the user.
//
// Transcript-aware on purpose: when the director's clarifying question is
// answered, the workflow re-runs this classifier and the answer (chip pick or
// free text) is in the transcript, so the verdict resolves without any
// answer-parsing in workflow code.

import { completion } from '@reelmakeeasy/common/llm'
import { logger } from '@reelmakeeasy/common/logger'
import { z } from 'zod'

import type { AgentEvent, ArtifactSlot } from '../../workflows/uip-v2/types'

import { foldSession } from './session-state'

export interface ClassifyPastedUrlInput {
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
  /** Session/project id, telemetry only; classification works without it. */
  projectId?: string
  /** 0-based router run index (workflow-computed), telemetry only. */
  runCount?: number
  /** Normalized URL from the shared article_probe detector. */
  url: string
  /** Session owner, telemetry only; tracking is skipped when absent. */
  userId?: string
}

export interface ClassifyPastedUrlResult {
  /** 'error' = classifier failed; the workflow falls back to today's routing. */
  classification: 'article' | 'brand' | 'error'
  confidence: number
}

const UrlRouteVerdictSchema = z.object({
  // z.enum (NOT free string): the router branches deterministically on this.
  classification: z.enum(['article', 'brand']),
  confidence: z.coerce.number().min(0).max(1),
  reasoning: z.string(),
})

// Transcript excerpt cap: enough to carry the pasted message plus the
// director's clarifying exchange, small enough to keep the call cheap.
const TRANSCRIPT_TAIL_MESSAGES = 12
const TRANSCRIPT_CHAR_CAP = 4_000

function buildUrlRoutePrompt(url: string, transcriptExcerpt: string): string {
  return `You route a link a user pasted into a video-creation product. Decide which pipeline the link belongs to.

Definitions:
- "article": the link is CONTENT to be turned into a video -- a news story, blog post, editorial, newsletter issue, tweet/X post, or similar article-like page. Signals: news/blog/magazine domains, twitter.com/x.com status links, medium/substack, paths like /news/, /blog/, /articles/, dated paths (/2026/07/), long slugs that read like headlines.
- "brand": the link is the user's OWN business/product website to promote -- a company homepage or product/landing page. Signals: bare root domains, /products, /pricing, /about, SaaS/shop landing pages, the user talking about "my site", "our company", advertising intent.

The USER'S OWN WORDS override URL shape: if the conversation shows the user answered a routing question or stated what they want (e.g. "turn this article into a video" or "this is my company site"), follow that with confidence 1.0.

URL:
${url}

Conversation (most recent last):
---
${transcriptExcerpt}
---

Return ONLY a JSON object (no prose, no markdown fences):
{"classification": "article" or "brand", "confidence": 0.0-1.0, "reasoning": "<= 20 words"}

confidence is your confidence in the classification. Use >= 0.95 only when the signals are unambiguous; when the URL could plausibly be either (e.g. a company's blog post used as promotion, an unknown bare domain with an ambiguous slug), stay below 0.95 so the product can ask the user.`
}

/**
 * Classify the pasted URL as article vs brand with a confidence score.
 * NEVER throws: any failure returns {classification: 'error', confidence: 0}
 * so the workflow falls back to the pre-router behavior (brand auto-start).
 */
export async function classifyPastedUrlActivity(
  input: ClassifyPastedUrlInput,
): Promise<ClassifyPastedUrlResult> {
  try {
    const { events } = input
    const session = foldSession(events, input.currentArtifacts)
    const excerpt = session.transcript
      .slice(-TRANSCRIPT_TAIL_MESSAGES)
      .map((m) => `${m.role}: ${(m.content ?? '').slice(0, 600)}`)
      .join('\n')
      .slice(-TRANSCRIPT_CHAR_CAP)

    const verdict = await completion({
      models: 'flash',
      prompt: buildUrlRoutePrompt(input.url, excerpt),
      responseFormat: UrlRouteVerdictSchema,
      task: 'uip-url-route-classify',
    })
    logger.info(
      `[${session.sessionId}] url-router verdict classification=${verdict.classification} confidence=${verdict.confidence} url=${input.url} reasoning=${verdict.reasoning}`,
    )
    const result: ClassifyPastedUrlResult = {
      classification: verdict.classification,
      confidence: verdict.confidence,
    }
    return result
  } catch (err) {
    logger.warn(
      `url-router classification failed, falling back to legacy routing url=${input.url}: ${err instanceof Error ? err.message : String(err)}`,
    )
    const fallback: ClassifyPastedUrlResult = { classification: 'error', confidence: 0 }
    return fallback
  }
}
