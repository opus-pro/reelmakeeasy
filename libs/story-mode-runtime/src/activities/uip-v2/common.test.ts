import { postToInternalApi } from './common'

describe('postToInternalApi', () => {
  const realFetch = global.fetch
  const realPort = process.env['PORT']
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(new Response('{}'))
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
    if (realPort === undefined) delete process.env['PORT']
    else process.env['PORT'] = realPort
  })

  it('calls the API on 127.0.0.1:5017 by default', async () => {
    delete process.env['PORT']
    await postToInternalApi('persist', { ok: true })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:5017/api/uip-sessions/internal/persist',
    )
  })

  it("calls this copy's API when PORT moved it", async () => {
    process.env['PORT'] = '5117'
    await postToInternalApi('/claim-next-action', { ok: true })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:5117/api/uip-sessions/internal/claim-next-action',
    )
  })
})
