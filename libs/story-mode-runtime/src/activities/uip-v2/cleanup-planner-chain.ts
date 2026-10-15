/**
 * The planner talks to an OpenAI-compatible chat endpoint, which keeps no
 * server-side response chains, so there is nothing to delete at session end.
 * Kept as an activity so the UIP workflow's exit path stays unchanged.
 */
export async function cleanupPlannerChainActivity(_params: {
  projectId: string
  responseId: string
}): Promise<void> {}
