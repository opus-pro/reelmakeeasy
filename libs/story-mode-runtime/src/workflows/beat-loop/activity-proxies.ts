import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'

import type * as activities from '../../activities/beat-loop'

// One TTS call per line, so cheap: it runs first. A line too long to fit its clip fails
// without a retry and names every long line.
export const { generateBeatLoopVoiceover } = proxyActivitiesWrapper<
  Pick<typeof activities, 'generateBeatLoopVoiceover'>
>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '1 minute',
  },
})

// f0 from text, then one edit per frame in order: two retries, then the run fails and the
// user gets Try again. Frames already made for the same prompts are reused.
export const { generateBeatLoopKeyframes } = proxyActivitiesWrapper<
  Pick<typeof activities, 'generateBeatLoopKeyframes'>
>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '1 minute',
  },
})

// One take of one clip. The activity walks the loop's models itself, and a take that renders
// but fails QA comes back as a result, not an error: the workflow decides on re-rolls. One
// retry covers a transient failure; a safety block or no loop model fails at once.
export const { renderBeatLoopClip } = proxyActivitiesWrapper<
  Pick<typeof activities, 'renderBeatLoopClip'>
>({
  startToCloseTimeout: '1 hour',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '30 seconds',
    maximumInterval: '2 minutes',
  },
})

// The QA record (long_take/beat_loop_qa.json): small reads and writes.
export const { keepBeatLoopTake, readBeatLoopQa } = proxyActivitiesWrapper<
  Pick<typeof activities, 'keepBeatLoopTake' | 'readBeatLoopQa'>
>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds',
    maximumInterval: '20 seconds',
  },
})
