import { useRunningInpaintGenerationCount } from './useUnrenderedChanges'

export function useInpaintGenerationRunning(projectId: string): boolean {
  // An action taken mid-generation would act on the pre-generation video, so it
  // is held until the server reports the runs settled.
  return useRunningInpaintGenerationCount(projectId, false) > 0
}
