import type { PushedChunk } from '@reelmakeeasy/common/agent-v2/util/push-chunks'
import { SSEBus } from '@reelmakeeasy/common/sse/sse'
import { serveStoredUrls, toSavedAddresses } from '@reelmakeeasy/common/storage/address'
import type { CallHandler, ExecutionContext, MessageEvent } from '@nestjs/common'
import { firstValueFrom, of, take, toArray } from 'rxjs'

import { ServedUrlsInterceptor } from '../interceptors/served-urls.interceptor'
import { createChunkSink } from '../workflow-runs/chunk-sink'

// Without PUBLIC_FILES_URL the API serves stored files at localhost:<PORT>/api/files.
const FILES = 'http://localhost:5017/api/files'

const project = {
  bgmBedCdnUrl: 'store://projects/p1/bgm/bed-1.mp3',
  bgmBedUri: 'store://projects/p1/bgm/bed-1.mp3',
  id: 'p1',
  previewThumbnail: 'store://agent/workspace/p1/_thumbnail/final_video.mp4.jpg',
  resultVideo: 'store://agent/workspace/p1/final_video.mp4',
  styleThumbnailUrl: 'preset://v006/story-mode/styles/anime.webp',
}

describe('stored files are saved as addresses and served as URLs', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('builds the URLs of a response as it leaves the API', async () => {
    const next: CallHandler = { handle: () => of({ project, total: 1 }) }
    const body = await firstValueFrom(
      new ServedUrlsInterceptor().intercept({} as ExecutionContext, next),
    )
    expect(body).toEqual({
      project: {
        ...project,
        bgmBedCdnUrl: `${FILES}/projects/p1/bgm/bed-1.mp3`,
        previewThumbnail: `${FILES}/agent/workspace/p1/_thumbnail/final_video.mp4.jpg`,
        resultVideo: `${FILES}/agent/workspace/p1/final_video.mp4`,
        styleThumbnailUrl: 'http://localhost:5017/api/presets/v006/story-mode/styles/anime.webp',
      },
      total: 1,
    })
  })

  it('follows the API when it moves: nothing saved names a host or port', async () => {
    process.env['PORT'] = '5127'
    const next: CallHandler = { handle: () => of(project) }
    const body = await firstValueFrom(
      new ServedUrlsInterceptor().intercept({} as ExecutionContext, next),
    )
    expect((body as typeof project).resultVideo).toBe(
      'http://localhost:5127/api/files/agent/workspace/p1/final_video.mp4',
    )
  })

  it('builds the URLs of a live event too, encoded or not', async () => {
    const bus = new SSEBus({ heartbeatMs: 0 })
    const events = firstValueFrom(bus.stream().pipe(take(4), toArray()))
    await bus.push({ data: { resultVideo: project.resultVideo }, type: 'project-patch' })
    await bus.push({
      data: JSON.stringify({ thumbnailUrl: project.previewThumbnail }),
      type: 'long-take-status',
    } as MessageEvent)
    await bus.push({
      data: JSON.stringify({ thumbnailUrl: project.styleThumbnailUrl }),
      type: 'long-take-status',
    } as MessageEvent)
    const [, patch, encoded, encodedPreset] = await events
    expect(JSON.parse(String(patch?.data))).toEqual({
      resultVideo: `${FILES}/agent/workspace/p1/final_video.mp4`,
    })
    expect(JSON.parse(String(encoded?.data))).toEqual({
      thumbnailUrl: `${FILES}/agent/workspace/p1/_thumbnail/final_video.mp4.jpg`,
    })
    expect(JSON.parse(String(encodedPreset?.data))).toEqual({
      thumbnailUrl: 'http://localhost:5017/api/presets/v006/story-mode/styles/anime.webp',
    })
  })

  it("serves an agent chat's saved events: the camera card's samples and the chosen style", async () => {
    // As the agent SSE route emits a replayed event from the chat's events.jsonl.
    const sample = (id: string) => ({
      posterUrl: `preset://v007/camera-samples/${id}.jpg`,
      videoUrl: `preset://v007/camera-samples/${id}.mp4`,
    })
    const card = {
      data: {
        questionId: 'autonomous-camera-1',
        questions: [{ options: [{ label: 'Calm', sample: sample('calm') }] }],
        type: 'question',
      },
      id: '7',
      type: 'agent',
    }
    const chosen = {
      data: {
        styleId: 'anime',
        styleName: 'Anime',
        thumbnailUrl: 'preset://v007/story-mode/styles/anime.webp',
        type: 'style_chosen',
      },
      id: '8',
      type: 'agent',
    }
    const next: CallHandler = { handle: () => of(card, chosen) }
    process.env['PORT'] = '5127'
    const [servedCard, servedChosen] = await firstValueFrom(
      new ServedUrlsInterceptor().intercept({} as ExecutionContext, next).pipe(toArray()),
    )
    const PRESETS = 'http://localhost:5127/api/presets/v007'
    expect(servedCard).toEqual({
      ...card,
      data: {
        ...card.data,
        questions: [
          {
            options: [
              {
                label: 'Calm',
                sample: {
                  posterUrl: `${PRESETS}/camera-samples/calm.jpg`,
                  videoUrl: `${PRESETS}/camera-samples/calm.mp4`,
                },
              },
            ],
          },
        ],
      },
    })
    expect(servedChosen).toEqual({
      ...chosen,
      data: { ...chosen.data, thumbnailUrl: `${PRESETS}/story-mode/styles/anime.webp` },
    })
  })

  it('keeps the editor draft with addresses and gives the browser its URLs back', () => {
    const sent = {
      workingState: {
        keyframes: [{ keyframeUrl: `${FILES}/projects/p1/long_take/keyframes/LT_S1.png` }],
        transitions: [{ videoUri: `${FILES}/projects/p1/long_take/transitions/t1.mp4?v=2` }],
      },
    }
    const saved = toSavedAddresses(sent, { everyField: true })
    expect(saved).toEqual({
      workingState: {
        keyframes: [{ keyframeUrl: 'store://projects/p1/long_take/keyframes/LT_S1.png' }],
        transitions: [{ videoUri: 'store://projects/p1/long_take/transitions/t1.mp4' }],
      },
    })
    expect(serveStoredUrls(saved, { everyField: true }).workingState.transitions[0]).toEqual({
      videoUri: `${FILES}/projects/p1/long_take/transitions/t1.mp4`,
    })
  })

  it('saves a workflow patch and status with addresses only', async () => {
    const kv = { del: jest.fn(async () => undefined), set: jest.fn(async () => undefined) }
    const prisma = { project: { update: jest.fn(async () => undefined) } }
    const sink = createChunkSink({
      getBus: async () => null,
      kv: kv as never,
      prisma: prisma as never,
    })
    const chunks: PushedChunk[] = [
      {
        content: { data: { resultVideo: `${FILES}/agent/workspace/p1/final_video.mp4` } },
        role: 'event',
        type: 'project-patch',
      },
      {
        status: { meta: { thumbnailUrl: `${FILES}/projects/p1/a.png` }, status: 'running' },
        type: 'long-take-status',
      } as PushedChunk,
    ]
    await sink({ chunks, projectId: 'p1', userId: 'u' })
    expect(prisma.project.update).toHaveBeenCalledWith({
      data: { resultVideo: 'store://agent/workspace/p1/final_video.mp4' },
      where: { id: 'p1' },
    })
    expect(kv.set).toHaveBeenCalledWith(
      'long-take:status:p1',
      { meta: { thumbnailUrl: 'store://projects/p1/a.png' }, status: 'running' },
      expect.any(Number),
    )
  })
})
