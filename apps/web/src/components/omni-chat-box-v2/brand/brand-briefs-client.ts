import type { CreateSSEConnection, FetchApiDomain, FetchResponse } from '@/hooks/useApi'
import type { SSEConnection } from '@/util/sse'

import { assetPreviewUri } from './brand-asset-preview'

// Brand Library management client (Branding V2 M1). Reads the org's
// saved briefs for the submission-box selector and deletes them. The endpoints
// are 404 when `enable_saved_brand` is off for the org (BrandBriefGuard), so the
// selector stays dark until the feature ramps. Mirrors the createUipSession
// fetch pattern (fetchApiDomain + unwrap).
const BASE = '/api/brand-briefs'

// One staged asset on a saved brief, used to render the removable pre-UIP chips.
export interface BrandBriefAssetRef {
  asset_kind: 'character' | 'logo' | 'product'
  description?: null | string
  // The asset's stored identity AND the key every write path matches on -- the
  // uris echoed back in `stagedAssets` / `removeAssets` and in
  // `brand_brief_excluded_asset_uris`. Send this back verbatim; never a URL
  // derived from it.
  staging_uri: string
  // An optional fetchable URL for the same object. Usually absent, so always
  // read it through `assetPreviewUri` in `./brand-asset-preview`, never directly.
  viewable_url?: null | string
}

// Reference to the source style a brief entry points at (Branding V2 MS2): a
// preset (by slug) or a user custom style (UserSavedStyle id).
export type BrandBriefStyleRef =
  | { kind: 'custom'; userSavedStyleId: string }
  | { kind: 'preset'; presetId: string }

// One embedded style snapshot (written by the 1.3 Confirm + Save). The selector
// carries it into the new session so the brand's look comes along. `styleRef` is
// the MS2 source-of-truth pointer; snapshot fields are kept transitionally.
export interface BrandBriefStyleSnapshot {
  brand_style_preview_url?: string
  brand_style_text?: string
  // Marks the brand's default style; the library read view badges it.
  isDefault?: boolean
  // Set by the BE only when the library website synthesis generated this style
  // for the brand; user-picked styles and the hybrid variant never carry it.
  origin?: 'brand_generated'
  style_name?: string
  style_text?: string
  style_thumbnail_url?: string
  styleRef?: BrandBriefStyleRef
}

// The selector's view of a saved brief. The list endpoint returns the full row;
// only the fields the FE needs are typed here.
export interface BrandBriefSummary {
  brandBank?: {
    // Free-text "about us" summary shown in the read view.
    basic_info?: {
      about_us_summary?: null | string
      business_name?: null | string
    }
    // Extracted calls-to-action; the read view shows the first one's label as
    // the brand's key message to audience.
    ctas?: { href?: string; label?: string }[]
    staged_assets?: {
      character?: BrandBriefAssetRef[]
      logo?: BrandBriefAssetRef[]
      product?: BrandBriefAssetRef[]
    }
  }
  brandName: string
  // Optional defensively: rows predating the column would omit it, and the
  // unseen-badge count simply skips briefs without it.
  createdAt?: string
  id: string
  // Marks the org's default brand brief; the read view badges it.
  isDefault?: boolean
  lastUsedAt: string
  savedKind: string
  sourceDomain: null | string
  sourceUrl?: null | string
  // Stamped when the post-confirm custom-style generation starts, cleared once
  // it finishes (success or failure). While fresh, the library shows a
  // generating placeholder tile in the brand's styles row.
  styleGenerationPendingAt?: null | string
  styles?: BrandBriefStyleSnapshot[]
  videosCreated: number
}

function unwrap<T>(response: FetchResponse<T>): T {
  if (!response.ok) {
    throw new Error(response.error || `HTTP ${response.status}`)
  }
  return response.data
}

let lastPeopleCount: null | number = null

/** Org's saved briefs, most-recently-used first (BE orders by lastUsedAt desc). */
export async function listBrandBriefs(
  fetchApiDomain: FetchApiDomain,
): Promise<BrandBriefSummary[]> {
  const rows = unwrap(await fetchApiDomain<BrandBriefSummary[]>(BASE, { method: 'GET' }))
  if (rows.length !== lastPeopleCount) {
    lastPeopleCount = rows.length
  }
  return rows
}

/** Delete a saved brief and its durable asset folder. */
export async function deleteBrandBrief(fetchApiDomain: FetchApiDomain, id: string): Promise<void> {
  unwrap(
    await fetchApiDomain<{ deleted: boolean; id: string }>(`${BASE}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  )
}

// One streamed style-preview tile (mirrors the BE SceneSampleResult shape).
export interface BrandStyleSample {
  archetypeId: string
  imageUrl: string
  label: string
}

// Callbacks the create-brand modal wires into the extraction SSE. Every handler
// is optional; the stream always ends with onDone (bus `complete`) or onError.
export interface BrandCreateStreamHandlers {
  onBriefSaved?: (briefId: string) => void
  // Brief was not created -- `reason` is `skipped` (no brand name could be
  // extracted). The run ends after this.
  onBriefSkipped?: (reason: string) => void
  onDone?: () => void
  onError?: (message: string) => void
  // `subReason` is the backend's granular failure cause (e.g. `internal_error`,
  // `bank_assembly_failed`, or a specific extraction failure), so a caller can
  // tell extraction failures apart by cause. Optional: absent on legacy payloads.
  onExtractionFailed?: (message: string, subReason?: string) => void
  onSample?: (sample: BrandStyleSample) => void
  onStatus?: (phase: string) => void
  onStyleError?: (message: string) => void
  onStyleSkipped?: (reason: string) => void
}

/**
 * Start a create-brand run. The brief is built from a website URL OR a text
 * description (+ optional reference-image staging URIs). Returns once the run is
 * accepted; progress arrives over the matching SSE stream (connectBrandCreateStream).
 */
export async function startBrandCreate(
  fetchApiDomain: FetchApiDomain,
  sessionId: string,
  body: { images?: string[]; text?: string; url?: string },
): Promise<void> {
  unwrap(
    await fetchApiDomain<{ sessionId: string; status: string }>(
      `${BASE}/extractions/${encodeURIComponent(sessionId)}/start`,
      { data: body, method: 'POST' },
    ),
  )
}

/** Subscribe to a create-brand run's progress + live style previews. */
export function connectBrandCreateStream(
  createSSE: CreateSSEConnection,
  sessionId: string,
  handlers: BrandCreateStreamHandlers,
): SSEConnection {
  const parse = <T>(data: string): null | T => {
    try {
      return JSON.parse(data) as T
    } catch {
      return null
    }
  }
  const connection = createSSE(
    `${BASE}/extractions/${encodeURIComponent(sessionId)}/stream`,
    {
      brief: (p) => handlers.onBriefSaved?.(parse<{ briefId: string }>(p.data)?.briefId ?? ''),
      brief_skipped: (p) =>
        handlers.onBriefSkipped?.(parse<{ reason: string }>(p.data)?.reason ?? ''),
      complete: () => handlers.onDone?.(),
      error: (p) => handlers.onError?.(p.data || 'Connection error'),
      extraction_failed: (p) => {
        const payload = parse<{ message?: string; reason?: string }>(p.data)
        handlers.onExtractionFailed?.(payload?.message ?? '', payload?.reason)
      },
      message: () => undefined,
      sample: (p) => {
        const s = parse<BrandStyleSample>(p.data)
        if (s) {
          handlers.onSample?.(s)
        }
      },
      status: (p) => handlers.onStatus?.(parse<{ phase: string }>(p.data)?.phase ?? ''),
      style_error: (p) =>
        handlers.onStyleError?.(parse<{ message: string }>(p.data)?.message ?? ''),
      style_skipped: (p) =>
        handlers.onStyleSkipped?.(parse<{ reason: string }>(p.data)?.reason ?? ''),
    },
    { timeoutMs: 30_000, withCredentials: true },
  )
  connection.start().catch(() => handlers.onError?.('Failed to connect to the brand stream'))
  return connection
}

// Partial edit of a saved brief. Only the fields present are sent; the
// BE rewrites the bank for name/summary/key message/assets and the top-level
// styles column. Mirrors the BE UpdateBrandBriefPayload.
export interface UpdateBrandBriefPayload {
  // Brand "about us" summary.
  aboutUsSummary?: null | string
  // Newly uploaded assets to add (staged uris the BE copies into the durable
  // library). Re-bucketing/reorder/delete of existing assets goes via stagedAssets.
  addAssets?: { asset_kind: BrandBriefAssetRef['asset_kind']; staging_uri: string }[]
  brandName?: string
  // "Key message to audience" -- the first CTA's label.
  keyMessage?: null | string
  // Library assets to drop (by durable staging_uri); the BE cleans the stored file.
  removeAssets?: BrandBriefAssetRef[]
  // Full staged-asset layout after drag-drop re-bucketing / select-delete: the
  // staging_uris to keep per bucket, in order. The BE re-buckets and drops the
  // rest. Authoritative for assets when present.
  stagedAssets?: { character: string[]; logo: string[]; product: string[] }
  // Full style-ref array; remove-style sends it filtered.
  styles?: BrandBriefStyleSnapshot[]
}

// Manually-entered brand create: the non-AI create path. Only
// brandName is required; the rest mirror the edit form's fields. Assets are
// staged temp uris the BE copies into the durable library.
export interface CreateManualBrandBriefPayload {
  aboutUsSummary?: null | string
  assets?: { asset_kind: BrandBriefAssetRef['asset_kind']; staging_uri: string }[]
  brandName: string
  keyMessage?: null | string
  styles?: BrandBriefStyleSnapshot[]
}

/** Create a brand brief from manually-entered fields; returns the saved row. */
export async function createBrandBrief(
  fetchApiDomain: FetchApiDomain,
  payload: CreateManualBrandBriefPayload,
): Promise<BrandBriefSummary> {
  return unwrap(await fetchApiDomain<BrandBriefSummary>(BASE, { data: payload, method: 'POST' }))
}

/** Partial-update a saved brief; returns the updated row (BE re-reads on write). */
export async function updateBrandBrief(
  fetchApiDomain: FetchApiDomain,
  id: string,
  payload: UpdateBrandBriefPayload,
): Promise<BrandBriefSummary> {
  return unwrap(
    await fetchApiDomain<BrandBriefSummary>(`${BASE}/${encodeURIComponent(id)}`, {
      data: payload,
      method: 'PUT',
    }),
  )
}

/** Flatten a brief's staged assets across buckets into chip rows. */
export function briefAssetChips(brief: BrandBriefSummary): BrandBriefAssetRef[] {
  const staged = brief.brandBank?.staged_assets
  if (!staged) {
    return []
  }
  return [...(staged.logo ?? []), ...(staged.product ?? []), ...(staged.character ?? [])]
}

// Viewable logo URL for a brief, if any. Brief assets are durable store:// paths
// the browser can't render directly, so only http(s) thumbnails are returned;
// callers fall back to a brand-mark glyph otherwise.
export function briefLogoUrl(brief: BrandBriefSummary): null | string {
  const logo = briefAssetChips(brief).find((a) => a.asset_kind === 'logo')
  const uri = logo && assetPreviewUri(logo)
  return uri && /^https?:\/\//.test(uri) ? uri : null
}
