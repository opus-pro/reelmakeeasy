/**
 * Top-level log-attribute keys that carry PII and must never reach a log line.
 *
 * Consumed by both attribute paths into pino: the `mixin()` in `./index.ts`
 * (JobContext -> activity/service logs) and `../workflow/workflow-log-meta.ts`
 * (workflow `log.*` and sinks -> worker logs). One list, so the two paths
 * cannot drift.
 *
 * Constants only -- no runtime imports -- so it is safe to pull into modules that
 * must stay free of the worker/logger import graphs.
 */
export const LOG_META_PII_KEYS: readonly string[] = ['userEmail']
