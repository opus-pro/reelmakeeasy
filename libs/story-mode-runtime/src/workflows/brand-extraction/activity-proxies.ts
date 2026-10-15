/**
 * Activity proxies for BrandExtractionWorkflow.
 *
 * Crawl and synthesis have different timeout profiles, so they get separate
 * proxies:
 *
 *   - `crawlBrandSiteActivity`: 15 minutes. Playwright crawl over a real site
 *     fans out across many pages + screenshots + asset downloads; large brands
 *     (lots of category pages, slow CDNs) routinely take 5-10 min. 15m is
 *     headroom; the workflow run timeout (`BRAND_EXTRACTION_WORKFLOW_RUN_TIMEOUT`)
 *     caps total wall time. Heartbeat every 60s so a hung Chromium tab is
 *     killed within a minute.
 *
 *   - `synthesizeBrandActivity`: 5 minutes. Single `completion()` call against
 *     `gemini-2.5-flash` (typically completes in 5-15s; 5m is generous).
 *
 * Retries kept at 1 for both: a flaky crawl is
 * better surfaced as a typed failure that the user can re-trigger via the
 * Brand Brief card than retried 3x with exponential backoff -- the
 * user is blocking on this in the UIP loop, not a background batch job.
 */

import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'

import type * as activities from '../../activities/brand-extraction'

export const { crawlBrandSiteActivity } = proxyActivitiesWrapper<
  Pick<typeof activities, 'crawlBrandSiteActivity'>
>({
  startToCloseTimeout: '15 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 1,
  },
})

export const { synthesizeBrandActivity } = proxyActivitiesWrapper<
  Pick<typeof activities, 'synthesizeBrandActivity'>
>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 1,
  },
})

// Per-image vision describe over staged crawl assets. With caps of 6 logos +
// 10 products + 0 characters, worst case is 16 images at concurrency 3 ~ 10s;
// 5m is generous headroom. Best-effort: the activity catches internally and
// returns degraded shape on failure, so retries are not needed.
export const { describeStagedAssetsActivity } = proxyActivitiesWrapper<
  Pick<typeof activities, 'describeStagedAssetsActivity'>
>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 1,
  },
})
