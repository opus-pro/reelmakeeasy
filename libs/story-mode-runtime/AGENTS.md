# story-mode-runtime

Shared runtime library for Story Mode's workflows and activities, which run
on the in-process workflow engine (`libs/workflow-engine`).

## What's different from a replay-based engine

- **No replay.** The engine keeps no execution history to replay: a workflow
  run cut short by a restart is gone, not resumed (`libs/workflow-engine/src/journal.ts`
  only remembers which runs were open, to report them, not to replay them).
  There's no Non-Determinism Error to avoid, so changing the order, number or
  type of activity calls in a workflow is safe -- no gating needed.
- **Runs share the process.** Many workflow runs execute concurrently in the
  same Node process and the same module scope. Keep per-run state in local
  variables, or in `getRunLocal`/`setRunLocal` (`libs/workflow-engine/src/workflow.ts`)
  when it needs to survive an `await` -- never in a module-level variable,
  which every concurrent run would share.
- **Activities still retry and time out** the way they did before; they just
  run as plain async functions in this process instead of on a worker.

See `libs/workflow-engine/src/workflow.ts` for the full workflow API.
