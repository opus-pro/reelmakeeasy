const appendInputMessage = jest.fn(async (_prisma: unknown, _input: { message: string }) => ({
  answerStatus: 'accepted' as const,
  record: { id: 'r1' },
}))
jest.mock('./uip-input-inbox', () => ({
  appendInputMessage: (prisma: unknown, input: { message: string }) =>
    appendInputMessage(prisma, input),
}))

import { CURRENT_WORKFLOW_PROTOCOL_VERSION } from '@reelmakeeasy/common/uip/protocol-version'

import { sendMessageFn } from './uip-send-message'

const FILES = 'http://localhost:5017/api/files'

describe('sendMessageFn', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
    appendInputMessage.mockClear()
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it("saves the message with its uploads' addresses, never the URLs the browser had", async () => {
    const prisma = {
      uipSession: {
        findUnique: jest.fn(async () => ({
          phase: 'mode_confirmation',
          state: {
            auto_continue_enabled: false,
            workflow_protocol_version: CURRENT_WORKFLOW_PROTOCOL_VERSION,
          },
          status: 'active',
        })),
      },
    }
    await sendMessageFn(
      'p1',
      `Like this @img[Hero](upload_1|${FILES}/projects/p1/user-intent-planner/uploads/a/hero%20shot.png)`,
      undefined,
      undefined,
      'c1',
      { prisma: prisma as never, signalWorkflow: jest.fn(async () => undefined) },
    )
    expect(appendInputMessage.mock.calls[0]?.[1].message).toBe(
      'Like this @img[Hero](upload_1|store://projects/p1/user-intent-planner/uploads/a/hero%20shot.png)',
    )
  })
})
