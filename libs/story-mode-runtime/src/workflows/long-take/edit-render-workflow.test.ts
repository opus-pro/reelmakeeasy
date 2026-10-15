// The editor export on the real in-process engine, its render faked: what the user was looking
// at (the caption toggle and the caption look) reaches the render.
import { Client } from '@reelmakeeasy/workflow-engine/client'
import { configureEngine, registerWorker } from '@reelmakeeasy/workflow-engine/worker'

import { LongTakeEditRenderWorkflow } from './edit-render-workflow'
import type { LongTakeEditRenderWorkflowParams } from './types'

const QUEUE = 'edit-render-test'

const activities = {
  notifyBgmRemuxCompleted: jest.fn(async () => undefined),
  notifyBgmRemuxFailed: jest.fn(async () => undefined),
  renderLongTakeVideo: jest.fn(async () => ({
    bgmBaked: false,
    enableCaption: true,
    renderDurationMs: 1,
    thumbnailFallbackUsed: false,
    videoUri: 'store://final_video.mp4',
  })),
}

const noop = (): void => undefined
const silent = { debug: noop, error: noop, info: noop, trace: noop, warn: noop }

beforeAll(() => {
  configureEngine({ logger: silent })
  registerWorker({ activities, taskQueue: QUEUE, workflows: { LongTakeEditRenderWorkflow } })
})

beforeEach(() => jest.clearAllMocks())

let runSeq = 0
async function run(settings: LongTakeEditRenderWorkflowParams['settings']): Promise<unknown> {
  const handle = await new Client().workflow.start(LongTakeEditRenderWorkflow, {
    args: [
      {
        projectId: 'p1',
        settings,
        transitionVideos: [],
        userId: 'u1',
      } satisfies LongTakeEditRenderWorkflowParams,
    ],
    taskQueue: QUEUE,
    workflowId: `edit-render-test-${++runSeq}`,
  })
  await handle.result()
  // This run's render input (the engine adds the request context as a second argument).
  return (activities.renderLongTakeVideo.mock.calls.at(-1) as undefined | unknown[])?.[0]
}

describe('LongTakeEditRenderWorkflow', () => {
  it('renders the caption look the user was looking at, with the caption toggle', async () => {
    const captionStyle = { accent: '#FFE500', preset: 'explainer' as const }
    expect(await run({ captionEnabled: true, captionStyle })).toMatchObject({
      captionStyle,
      enableCaption: true,
      projectId: 'p1',
    })
    // null is a look too: the video kind's default.
    expect(await run({ captionEnabled: false, captionStyle: null })).toMatchObject({
      captionStyle: null,
      enableCaption: false,
    })
  })

  it('leaves the look to the project when the export says nothing about it', async () => {
    const input = await run({ captionEnabled: true })
    expect(input).not.toHaveProperty('captionStyle')
  })
})
