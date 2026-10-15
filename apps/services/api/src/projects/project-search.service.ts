import { logger } from '@reelmakeeasy/common/logger'
import { Injectable } from '@nestjs/common'
import type { ProjectForBackend } from '@shared/types/api/project'

import { PrismaService } from '../prisma/prisma.service'

import { enrichWithUipStatus, PROJECT_LIST_SELECT } from './projects-list.util'

export type MatchedField = 'initPrompt' | 'name' | 'script'

export const VECTOR_SEARCH_INDEX_NAME = 'project_search_vector_updated'
// autoEmbed paths queried on the vector index. searchText is the write-once
// script snapshot; the index does not embed the live script, so
// script-content search is served entirely by the searchText path.
export const VECTOR_SEARCH_PATHS = ['name', 'initPrompt', 'searchText'] as const
export const MAX_SEARCH_RESULTS = 200
// When no result has a token match (typos, synonyms), only show results
// above this score threshold to avoid noise.
export const SEMANTIC_SCORE_THRESHOLD = 0.75

export interface ProjectSearchInput {
  ownerId: string
  page: number
  pageSize: number
  search: string
}

export interface ProjectSearchResult {
  items: ProjectSearchResultItem[]
  total: number
}

export interface ProjectSearchResultItem {
  /**
   * Best-effort indicator of which field matched. Set when any query token
   * appears as a substring in the field text (case-insensitive). Left
   * undefined when the match is purely semantic (e.g. synonym or concept
   * overlap). Consumers should treat undefined as "no field-level highlight
   * or snippet."
   */
  matchedField?: MatchedField
  projectId: string
  score: number
}

interface AggregateResult {
  cursor: { firstBatch: RawProjectDoc[] }
}

/** Shape of the lexical (Prisma findMany) candidate rows. */
interface LexicalProjectDoc {
  createdAt?: Date | string
  id: string
  initPrompt?: string
  name?: string
}

interface RawProjectDoc {
  createdAt?: string
  id: string
  initPrompt?: string
  name?: string
  score?: number
  script?: string
}

@Injectable()
export class ProjectSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /** Batch fetch non-deleted projects by id including `script` for snippets. */
  async findProjectsByIds(ids: string[]): Promise<ProjectForBackend[]> {
    if (ids.length === 0) {
      return []
    }
    const projects = (await this.prisma.project.findMany({
      where: { id: { in: ids }, isDeleted: { not: true } },
      select: { ...PROJECT_LIST_SELECT, script: true },
    })) as unknown as ProjectForBackend[]
    await enrichWithUipStatus(this.prisma, projects)
    return projects
  }

  async search(input: ProjectSearchInput): Promise<ProjectSearchResult> {
    const take = Math.max(0, input.pageSize)
    const skip = Math.max(0, (input.page - 1) * take)

    // $vectorSearch does not support skip natively, so we fetch skip+take
    // results and slice in application code. Cap at MAX_SEARCH_RESULTS to
    // avoid fetching unbounded results for deep pagination.
    const fetchLimit = Math.min(skip + take, MAX_SEARCH_RESULTS)

    // Run parallel $vectorSearch queries -- one per auto-embedded path
    // (name, initPrompt, searchText) -- then merge and deduplicate by project
    // ID, keeping the highest score. This is equivalent to $rankFusion but
    // works on all Atlas versions.
    const fieldSearches = VECTOR_SEARCH_PATHS.map(
      (path) =>
        this.prisma.$runCommandRaw({
          aggregate: 'Project',
          cursor: {},
          pipeline: [
            {
              $vectorSearch: {
                index: VECTOR_SEARCH_INDEX_NAME,
                path,
                query: { text: input.search },
                model: 'voyage-4',
                numCandidates: Math.max(100, fetchLimit * 4),
                limit: fetchLimit,
                filter: {
                  $and: [{ owner: input.ownerId }, { isDeleted: { $ne: true } }],
                },
              },
            },
            {
              $project: {
                id: 1,
                name: 1,
                initPrompt: 1,
                script: 1,
                createdAt: 1,
                score: { $meta: 'vectorSearchScore' },
              },
            },
          ],
        }) as unknown as Promise<AggregateResult>,
    )

    // Lexical branch: a plain substring match on name/initPrompt rides the
    // existing { owner } index, so it needs no text/search index and scales
    // with one user's project count. It guarantees that typing a literal
    // fragment of a project name always finds it, independent of how well
    // the (possibly very short) query embeds.
    const lexicalSearch = this.prisma.project.findMany({
      where: {
        owner: input.ownerId,
        isDeleted: { not: true },
        OR: [
          { name: { contains: input.search, mode: 'insensitive' } },
          { initPrompt: { contains: input.search, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, initPrompt: true, createdAt: true },
      // Newest-first BEFORE the cap so a common substring with >200 matches
      // keeps the most recent projects rather than an arbitrary first batch.
      orderBy: { createdAt: 'desc' },
      take: MAX_SEARCH_RESULTS,
    })

    // Fail-soft per branch: while the Atlas index definition is in transition
    // (script path removed, searchText path added) a single unknown-path error
    // must not take down the whole search. Only when every branch fails do we
    // rethrow so the controller falls back to the unfiltered owner list.
    const [vectorOutcomes, lexicalOutcome] = await Promise.all([
      Promise.allSettled(fieldSearches),
      lexicalSearch.then(
        (docs) => ({ status: 'fulfilled', value: docs }) as const,
        (reason: unknown) => ({ status: 'rejected', reason }) as const,
      ),
    ])

    const failures = [...vectorOutcomes, lexicalOutcome].filter(
      (outcome) => outcome.status === 'rejected',
    )
    if (failures.length === vectorOutcomes.length + 1) {
      throw failures[0].reason
    }
    for (const [index, outcome] of vectorOutcomes.entries()) {
      if (outcome.status === 'rejected') {
        this.logBranchFailure(VECTOR_SEARCH_PATHS[index], outcome.reason)
      }
    }
    if (lexicalOutcome.status === 'rejected') {
      this.logBranchFailure('lexical', lexicalOutcome.reason)
    }

    const merged = this.mergeCandidates(vectorOutcomes, lexicalOutcome)

    // Two-tier filtering:
    // First check if any result has a direct token match. If yes, keep
    // only those (exact/partial keyword matches). If no result has a
    // token match (typo or synonym query like "britnney"), fall back to
    // semantic results above SEMANTIC_SCORE_THRESHOLD.
    //
    // Sort: score descending, then createdAt descending as tiebreaker
    // so that among equally scored results, newer projects appear first.
    const allSorted = [...merged.values()].sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0)
      if (Math.abs(scoreDiff) > 0.001) {
        return scoreDiff
      }
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bDate - aDate
    })

    const tokenMatches = allSorted.filter(
      (doc) => this.resolveMatchedField(doc, input.search) !== undefined,
    )
    const docs =
      tokenMatches.length > 0
        ? tokenMatches
        : allSorted.filter((doc) => (doc.score ?? 0) >= SEMANTIC_SCORE_THRESHOLD)

    // Cap BEFORE paging so deep pages cannot return rows beyond the reported
    // total (merged vector + lexical candidates can exceed the cap).
    const capped = docs.slice(0, MAX_SEARCH_RESULTS)
    const total = capped.length
    const paged = capped.slice(skip, skip + take)

    const items: ProjectSearchResultItem[] = paged.map((doc) => {
      const matchedField = this.resolveMatchedField(doc, input.search)
      const item: ProjectSearchResultItem = {
        projectId: doc.id,
        score: doc.score ?? 0,
      }
      if (matchedField !== undefined) {
        item.matchedField = matchedField
      }
      return item
    })

    return { items, total }
  }

  /** Logs a degraded search branch without any raw query/document content. */
  private logBranchFailure(branch: string, reason: unknown): void {
    const errorType = reason instanceof Error ? reason.constructor.name : 'UnknownError'
    logger.warn({
      event: 'project_search.branch_failed',
      branch,
      errorType,
    })
  }

  /**
   * Merges vector and lexical candidates, deduplicated by project id.
   * Vector docs win ties (they carry the real score plus the script text for
   * snippet/token resolution); lexical-only hits enter with score 0 so they
   * rank after vector token matches, then by createdAt.
   */
  private mergeCandidates(
    vectorOutcomes: Array<PromiseSettledResult<AggregateResult>>,
    lexicalOutcome:
      | { reason: unknown; status: 'rejected' }
      | { status: 'fulfilled'; value: LexicalProjectDoc[] },
  ): Map<string, RawProjectDoc> {
    const merged = new Map<string, RawProjectDoc>()
    for (const outcome of vectorOutcomes) {
      if (outcome.status !== 'fulfilled') {
        continue
      }
      for (const doc of outcome.value.cursor?.firstBatch ?? []) {
        const existing = merged.get(doc.id)
        if (!existing || (doc.score ?? 0) > (existing.score ?? 0)) {
          merged.set(doc.id, doc)
        }
      }
    }

    if (lexicalOutcome.status === 'fulfilled') {
      for (const doc of lexicalOutcome.value) {
        if (!merged.has(doc.id)) {
          merged.set(doc.id, {
            id: doc.id,
            name: doc.name,
            initPrompt: doc.initPrompt,
            createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
            score: 0,
          })
        }
      }
    }

    return merged
  }

  /**
   * Returns the field that contains a query token as a substring, checked
   * in priority order (name > initPrompt > script). Returns undefined when
   * no token match is found - this happens when the match is purely
   * semantic (e.g. synonym or concept overlap). Defaulting to 'name' in
   * that case would mislabel the hit, so we leave it undefined and let
   * the caller render without a field highlight.
   */
  private resolveMatchedField(doc: RawProjectDoc, query: string): MatchedField | undefined {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const containsToken = (text: string | undefined): boolean => {
      if (!text) {
        return false
      }
      const lower = text.toLowerCase()
      return tokens.some((token) => lower.includes(token))
    }
    if (containsToken(doc.name)) {
      return 'name'
    }
    if (containsToken(doc.initPrompt)) {
      return 'initPrompt'
    }
    if (containsToken(doc.script)) {
      return 'script'
    }
    return undefined
  }
}
