import type { ArgumentsHost } from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { APP_FILTER, BaseExceptionFilter } from '@nestjs/core'

import { LlmNotSetUpFilter } from './llm-not-set-up.filter'
import { SetupModule } from './setup.module'

const NONE = 'No AI is set up for writing and planning: open Setup'
const STALE = "Claude Code can't write and plan right now (Not installed): open Setup"
/** libs/llm's error, as the transport throws it. */
const notSetUp = (message = NONE) => Object.assign(new Error(message), { name: 'LlmNotSetUpError' })

function fakeHost(headersSent = false) {
  const res = { headersSent, json: jest.fn(), status: jest.fn() }
  res.status.mockReturnValue(res)
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost
  return { host, res }
}

describe('LlmNotSetUpFilter', () => {
  afterEach(() => jest.restoreAllMocks())

  it("answers 409 with the chosen AI's reason, even when the error was wrapped", () => {
    const wrapped = new Error('script preview failed', { cause: notSetUp(STALE) })
    const { host, res } = fakeHost()
    new LlmNotSetUpFilter().catch(wrapped, host)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ message: STALE, statusCode: 409 })
  })

  it('leaves every other error to Nest', () => {
    const base = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined)
    const { host, res } = fakeHost()
    const error = new Error('boom')
    new LlmNotSetUpFilter().catch(error, host)
    expect(base).toHaveBeenCalledWith(error, host)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('leaves a response that already started (a stream) to Nest', () => {
    const base = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined)
    const { host, res } = fakeHost(true)
    const error = notSetUp()
    new LlmNotSetUpFilter().catch(error, host)
    expect(base).toHaveBeenCalledWith(error, host)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('is registered app-wide by the Setup module', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SetupModule) as unknown[]
    expect(providers).toContainEqual({ provide: APP_FILTER, useClass: LlmNotSetUpFilter })
  })
})
