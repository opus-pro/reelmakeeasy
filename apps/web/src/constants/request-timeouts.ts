/**
 * Client-side ceiling for the session-create POST that gates the composer's
 * `isSending` state.
 *
 * The submit handlers clear `isSending` in a `finally`, so the spinner can only
 * stick if an awaited request never settles. `fetchApiDomain` passes `timeout`
 * straight to axios, and axios defaults to 0 (no timeout), so a request that
 * hangs -- a mobile radio handoff, a backgrounded tab, a dropped connection --
 * leaves the button disabled with a spinner for the life of the page.
 *
 * What sets the number is not latency -- it is whether the user pressing
 * Generate again is safe.
 */

/**
 * `POST /api/uip-sessions` -- the path ~99% of submissions take.
 *
 * A retry here is safe: the create is idempotent on the client-supplied
 * `sessionCreationId` (`uip-create-session.ts`). The server publishes
 * the projectId under that id and returns the same session to any duplicate for
 * `CREATE_RESULT_TTL_SECONDS` (30 min); a retry arriving while the original is
 * still in flight waits up to `CREATE_WAIT_MAX_MS` (20s) for the winner and
 * converges onto it. The client keys the id to the submission payload itself
 * (minus the sync-transient transitionVideoModel field while it is not a user
 * pick), so the id survives timeouts and retries -- including a
 * config sync landing between them -- and rotates only when the user actually
 * changes the submission.
 *
 * That makes firing early cheap and waiting expensive. A spinner the user cannot
 * escape guarantees an abandoned submission; a prompt to try again costs at
 * worst a deduped request that lands on the session already being created. So
 * this sits well above a normal create (a few seconds) rather than above the
 * slowest request one could imagine -- long enough that healthy requests are
 * never interrupted, short enough that the user is offered a way out while
 * still looking at it.
 */
export const UIP_SESSION_CREATE_TIMEOUT_MS = 15_000

/**
 * Shown when a request breaches its `timeout`. That only ever happens on a
 * request that never came back, and this endpoint commits its work before
 * responding -- so the job may well be running.
 *
 * Two constraints on the wording. It must not say "failed": that reads as
 * "nothing happened, start over", which is the one thing the user should not
 * conclude. And it must not explain why retrying is safe -- the dedupe on
 * `sessionCreationId` is what makes "try again" the right advice, but a user
 * does not need to reason about session identity to act on a toast.
 */
export const REQUEST_TIMEOUT_MESSAGE = 'This is taking longer than usual. Please try again.'
