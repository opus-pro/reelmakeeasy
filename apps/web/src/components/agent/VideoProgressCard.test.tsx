import { VIDEO_STARTED_MESSAGE } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type { LongTakeStatus } from '@shared/types/api/long-take'
import { act, render, screen } from '@testing-library/react'

import type { LongTakeArtifacts } from '@/app/long-take/hooks/useLongTakeArtifacts'

import { ProjectProgressProvider } from './ProjectProgressProvider'
import { VideoProgressCard } from './VideoProgressCard'
import { VIDEO_READY_LINE, videoFlaggedLine, VideoStartedLine } from './VideoStartedLine'

// The status poll, as the API answers it for the loop's project.
let mockArtifacts: Partial<LongTakeArtifacts> = {}
jest.mock('@/app/long-take/hooks/useLongTakeArtifacts', () => ({
  useLongTakeArtifacts: () => mockArtifacts,
}))
jest.mock('@/hooks/useApi', () => ({
  useApi: () => ({ fetchApiDomain: jest.fn(async () => ({ ok: false })) }),
}))
jest.mock('./AgentVideoPreview', () => ({
  AgentVideoPreview: ({ videoUrl }: { videoUrl: string }) => (
    <video aria-label="Your finished video" src={videoUrl} />
  ),
}))
jest.mock('./VideoActions', () => ({
  OpenInEditorLink: () => <a href="/editor">Open in editor</a>,
}))
jest.mock('./AgentMarkdown', () => ({
  AgentMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}))

const VIDEO = 'http://localhost:5017/api/files/projects/p1/final_video.mp4'

function loopStatus(status: Partial<LongTakeStatus>, videoUrl: null | string) {
  mockArtifacts = {
    audioPreviewUrl: 'http://localhost:5017/api/files/projects/p1/voice_over.mp3',
    script: null,
    status: { captionKind: 'loop', ...status } as LongTakeStatus,
    videoUrl,
  }
}

/** The loop's card and ReelMakeEasy's "being made" line under it, as the chat shows them. */
function Chat() {
  return (
    <ProjectProgressProvider projectIds={['p1']}>
      <VideoProgressCard projectId="p1" />
      <VideoStartedLine projectId="p1" text={VIDEO_STARTED_MESSAGE} />
    </ProjectProgressProvider>
  )
}

describe('a loop short in the chat, once its run finishes', () => {
  it('plays the finished video and says it is ready', () => {
    loopStatus({ stage: 'transitions', status: 'in_progress' }, null)
    const { rerender } = render(<Chat />)
    expect(screen.getByText('Making your video')).toBeTruthy()
    expect(screen.getByText(VIDEO_STARTED_MESSAGE)).toBeTruthy()

    loopStatus(
      {
        detail: 'Render complete.',
        meta: { beatLoopClips: 6 },
        stage: 'completed',
        status: 'completed',
      },
      VIDEO,
    )
    act(() => rerender(<Chat />))

    expect(screen.queryByText('Making your video')).toBeNull()
    expect(screen.getByLabelText('Your finished video').getAttribute('src')).toBe(VIDEO)
    expect(screen.queryByText(VIDEO_STARTED_MESSAGE)).toBeNull()
    expect(screen.getByText(VIDEO_READY_LINE)).toBeTruthy()
  })

  it('names the clips its checks still flag, in place of the ready line', () => {
    loopStatus(
      {
        meta: { beatLoopClips: 6, beatLoopFlaggedClips: 's3' },
        stage: 'completed',
        status: 'completed',
      },
      VIDEO,
    )
    render(<Chat />)
    expect(screen.getByLabelText('Your finished video')).toBeTruthy()
    expect(screen.getByText(videoFlaggedLine(['s3']))).toBeTruthy()
    expect(screen.queryByText(VIDEO_STARTED_MESSAGE)).toBeNull()
  })
})
