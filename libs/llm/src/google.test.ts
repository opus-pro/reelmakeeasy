import {
  GOOGLE_SAFETY_MESSAGE,
  GoogleApiError,
  googleHttpError,
  inlineDataFromUri,
  inlineParts,
  interactionContent,
  runGoogle,
} from './google'

interface Call {
  body?: string
  headers: Record<string, string>
  method: string
  redirect?: string
  url: string
}

const API = 'https://generativelanguage.googleapis.com/v1beta'

/** Answers each fetch with the next scripted response and records the requests. */
function scriptFetch(responses: Array<() => Response>): Call[] {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      body: init?.body ? String(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
      method: init?.method ?? 'GET',
      redirect: init?.redirect,
      url: String(input),
    })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected fetch ${String(input)}`)
    return next()
  }) as typeof fetch
  return calls
}

const json =
  (value: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(value), { status })

/** The error a call throws, for checking its fields. */
async function failure(call: () => Promise<unknown>): Promise<GoogleApiError> {
  const error = await call().then(
    () => undefined,
    (err: unknown) => err,
  )
  if (!(error instanceof GoogleApiError))
    throw new Error(`expected a GoogleApiError, got ${String(error)}`)
  return error
}

function thrown(call: () => unknown): GoogleApiError {
  try {
    call()
  } catch (error) {
    if (error instanceof GoogleApiError) return error
    throw error
  }
  throw new Error('expected a GoogleApiError')
}

beforeEach(() => {
  process.env['GEMINI_API_KEY'] = 'test-key'
})

describe('runGoogle.generateContent', () => {
  it('posts to the model with the key header', async () => {
    const calls = scriptFetch([json({ candidates: [] })])
    await runGoogle.generateContent('gemini-3-pro-image', { contents: [] })
    expect(calls[0]?.url).toBe(`${API}/models/gemini-3-pro-image:generateContent`)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers['x-goog-api-key']).toBe('test-key')
  })

  it('fails in plain words when the key is missing', async () => {
    delete process.env['GEMINI_API_KEY']
    await expect(runGoogle.generateContent('m', {})).rejects.toThrow(/GEMINI_API_KEY is not set/)
  })

  it('reports a quota error as rate_limit, in plain words', async () => {
    scriptFetch([json({ error: { message: 'Resource has been exhausted' } }, 429)])
    const error = await failure(() => runGoogle.generateContent('m', {}))
    expect(error.message).toMatch(/Gemini API limit is used up/)
    expect(error).toMatchObject({ httpStatus: 429, provider: 'google', providerCode: 'rate_limit' })
  })
})

describe('googleHttpError', () => {
  it.each([
    [400, 'API key not valid. Please pass a valid API key.', /rejected the API key/, 'auth_error'],
    [
      400,
      'User location is not supported for the API use.',
      /isn't available in your region/,
      'invalid_input',
    ],
    [400, 'The prompt was blocked by safety filters', /safety filter/, 'policy_blocked'],
    [400, 'The input image was blocked by safety filters', /safety filter/, 'policy_blocked_image'],
    [
      403,
      'Billing is required: this model is only on the paid tier',
      /paid Gemini API plan/,
      'auth_error',
    ],
    // Every Gemini 429 says "check your plan and billing details": a paid key over a
    // per-minute limit waits and retries, only a quota of zero needs a paid plan.
    [
      429,
      'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model, limit: 10, model: veo-3.1-fast-generate-preview. Please retry in 41s.',
      /Gemini API limit is used up/,
      'rate_limit',
    ],
    [
      429,
      'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 0, model: veo-3.1-fast-generate-preview',
      /paid Gemini API plan/,
      'auth_error',
    ],
    [404, 'models/x is not found', /model id may have changed/, 'invalid_input'],
    [500, 'boom', /Gemini model x failed \(500\): boom/, 'internal_error'],
  ])('maps %i %s', (status, body, message, providerCode) => {
    const error = googleHttpError('model x', status, body)
    expect(error.message).toMatch(message)
    expect(error).toMatchObject({ detail: body, httpStatus: status, providerCode })
  })
})

describe('runGoogle.pollOperation', () => {
  const name = 'models/veo-3.1-fast-generate-preview/operations/1'

  it('polls until the operation is done', async () => {
    const calls = scriptFetch([
      json({ done: false, name }),
      json({ done: true, name, response: { ok: 1 } }),
    ])
    const op = await runGoogle.pollOperation(name, { intervalMs: 1 })
    expect(op.response).toEqual({ ok: 1 })
    expect(calls.map((c) => c.url)).toEqual([`${API}/${name}`, `${API}/${name}`])
  })

  it('retries a failed status check, then reports a quota error as rate_limit', async () => {
    scriptFetch([
      json({}, 503),
      json({ done: true, error: { code: 8, message: 'Quota exceeded' }, name }),
    ])
    const error = await failure(() => runGoogle.pollOperation(name, { intervalMs: 1 }))
    expect(error.message).toMatch(/Gemini API limit is used up/)
    expect(error).toMatchObject({ providerCode: 'rate_limit', rawProviderCode: '8' })
  })

  it('reports any other operation error as task_failed', async () => {
    scriptFetch([json({ done: true, error: { code: 13, message: 'Internal error' }, name })])
    const error = await failure(() => runGoogle.pollOperation(name, { intervalMs: 1 }))
    expect(error.providerCode).toBe('task_failed')
  })

  it('stops at once on a client error', async () => {
    scriptFetch([json({ error: { message: 'API key not valid' } }, 400)])
    const error = await failure(() => runGoogle.pollOperation(name, { intervalMs: 1 }))
    expect(error.providerCode).toBe('auth_error')
  })
})

describe('files', () => {
  it('waits for a generated file, then downloads it with the key', async () => {
    const uri = `${API}/files/abc123:download?alt=media`
    const calls = scriptFetch([
      json({ name: 'files/abc123', state: 'PROCESSING', uri }),
      json({ name: 'files/abc123', state: 'ACTIVE', uri }),
      () => new Response(Buffer.from('mp4-bytes')),
    ])
    const bytes = await runGoogle.download(uri, { intervalMs: 1, waitUntilActive: true })
    expect(bytes.toString()).toBe('mp4-bytes')
    expect(calls[0]?.url).toBe(`${API}/files/abc123`)
    expect(calls[2]?.headers['x-goog-api-key']).toBe('test-key')
    expect(calls[2]?.redirect).toBe('manual')
  })

  it('never sends the key to another host, even through a redirect', async () => {
    const calls = scriptFetch([
      () =>
        new Response(null, {
          headers: { location: 'https://storage.example.com/v1.mp4?sig=1' },
          status: 302,
        }),
      () => new Response(Buffer.from('mp4')),
      () => new Response(Buffer.from('other')),
    ])
    await runGoogle.download(`${API}/files/v1:download?alt=media`)
    expect(calls[0]?.headers['x-goog-api-key']).toBe('test-key')
    expect(calls[1]?.url).toBe('https://storage.example.com/v1.mp4?sig=1')
    expect(calls[1]?.headers).not.toHaveProperty(['x-goog-api-key'])
    await runGoogle.download('https://cdn.example.com/clip.mp4')
    expect(calls[2]?.headers).not.toHaveProperty(['x-goog-api-key'])
  })

  it('uploads with the resumable protocol', async () => {
    const calls = scriptFetch([
      () => new Response('{}', { headers: { 'x-goog-upload-url': 'https://upload.example/u1' } }),
      json({ file: { name: 'files/f1', state: 'ACTIVE', uri: `${API}/files/f1` } }),
    ])
    const file = await runGoogle.upload(Buffer.from('audio'), 'audio/mp3', 'speech')
    expect(file.uri).toBe(`${API}/files/f1`)
    expect(calls[0]?.headers['X-Goog-Upload-Protocol']).toBe('resumable')
    expect(calls[0]?.headers['X-Goog-Upload-Header-Content-Type']).toBe('audio/mp3')
    expect(calls[1]?.url).toBe('https://upload.example/u1')
    expect(calls[1]?.headers['X-Goog-Upload-Command']).toBe('upload, finalize')
  })
})

describe('reading answers', () => {
  it('takes the final picture, not the thinking drafts', () => {
    const res = {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { data: 'draft', mimeType: 'image/png' }, thought: true },
              { text: 'here you go' },
              { inlineData: { data: 'final', mimeType: 'image/png' } },
            ],
          },
        },
      ],
    }
    expect(inlineParts(res, 'image').map((p) => p.data)).toEqual(['final'])
  })

  it('marks a blocked prompt policy_blocked and a blocked picture policy_blocked_image', () => {
    const prompt = thrown(() => inlineParts({ promptFeedback: { blockReason: 'SAFETY' } }, 'image'))
    expect(prompt.message).toBe(GOOGLE_SAFETY_MESSAGE)
    expect(prompt).toMatchObject({ providerCode: 'policy_blocked', rawProviderCode: 'SAFETY' })
    const picture = thrown(() =>
      inlineParts({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }, 'image'),
    )
    expect(picture).toMatchObject({
      providerCode: 'policy_blocked_image',
      rawProviderCode: 'IMAGE_SAFETY',
    })
  })

  it('marks an empty answer no_output', () => {
    const empty = thrown(() => inlineParts({ candidates: [{ finishReason: 'STOP' }] }, 'audio'))
    expect(empty).toMatchObject({ providerCode: 'no_output', rawProviderCode: 'STOP' })
  })

  it('reads a video block from an interaction', () => {
    const interaction = {
      steps: [
        { type: 'thought' },
        {
          content: [
            { mime_type: 'video/mp4', type: 'video', uri: `${API}/files/v1:download?alt=media` },
          ],
          type: 'model_output',
        },
      ],
    }
    expect(interactionContent(interaction, 'video').uri).toBe(`${API}/files/v1:download?alt=media`)
    expect(() => interactionContent({ steps: [] }, 'video')).toThrow(/returned no video/)
  })

  it('reads data URIs', () => {
    expect(inlineDataFromUri('data:image/jpeg;base64,QUJD')).toEqual({
      data: 'QUJD',
      mimeType: 'image/jpeg',
    })
    expect(() => inlineDataFromUri('https://x/a.png')).toThrow(/base64 data URIs/)
  })
})
