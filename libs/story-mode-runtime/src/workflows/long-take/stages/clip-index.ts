/** Each clip's position in the video, for the Dynamic camera-move rotation. */
export function clipIndexByTransitionId(
  plan: ReadonlyArray<{ transitionId: string }>,
): Map<string, number> {
  return new Map(plan.map((seed, index) => [seed.transitionId, index]))
}
