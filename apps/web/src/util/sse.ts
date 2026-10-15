import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

export type SSEHandlers = {
  // Custom event handlers
  [event: string]: ((payload: SSEPayload) => void) | undefined
  // Provide optional explicit handlers for hello/ping; defaults will be added
  complete?: (payload: SSEPayload) => void
  error?: (payload: SSEPayload & { raw_error?: Error }) => void
  hello?: (payload: SSEPayload) => void
  live?: (payload: SSEPayload) => void
  // Optional common handlers
  message: (payload: SSEPayload) => void
  ping?: (payload: SSEPayload) => void
}
export type SSEOptions = {
  headers?: HeadersInit
  params?: Record<string, boolean | number | string>
  // Timeout in ms to wait for a 'hello' event after start; if not received, fail
  timeoutMs?: number
  withCredentials?: boolean
}

type SSEPayload = { data: string; event?: string; id?: string }

export class SSEConnection {
  // Native EventSource-like readyState values
  public readonly CLOSED = 2
  public readonly CONNECTING = 0
  public readonly OPEN = 1
  get readyState(): 0 | 1 | 2 {
    return this._readyState
  }
  private _readyState: 0 | 1 | 2 = 2
  private controller: AbortController | null = null
  private handlers: SSEHandlers

  constructor(
    private readonly url: string,
    handlers: SSEHandlers,
    private readonly options: SSEOptions = {},
  ) {
    // Default no-op implementations so consumers don't have to handle hello/ping
    this.handlers = {
      hello: (_: SSEPayload) => void 0,
      ping: (_: SSEPayload) => void 0,
      complete: (_: SSEPayload) => void 0,
      ...handlers,
    }
  }

  close(reason?: string) {
    if (this.controller) {
      // Abort the controller if it exists and hasn't been aborted yet
      if (!this.controller.signal.aborted) {
        this.controller.abort(reason || 'User cancelled the operation')
      }
      this.controller = null
    }
    this._readyState = this.CLOSED
  }

  async start() {
    if (this.controller) {
      return
    }
    this.controller = new AbortController()
    const { signal } = this.controller
    this._readyState = this.CONNECTING

    const q = new URLSearchParams()
    Object.entries(this.options.params || {}).forEach(([k, v]) => q.set(k, String(v)))
    const fullUrl = q.toString() ? `${this.url}?${q}` : this.url

    const headers = new Headers(this.options.headers || {})
    headers.set('Accept', 'text/event-stream')
    let resp: Response
    try {
      resp = await fetch(fullUrl, {
        method: 'GET',
        headers,
        signal,
        credentials: this.options.withCredentials ? 'include' : 'same-origin',
        cache: 'no-store',
      })
    } catch (e) {
      throw signal.aborted ? abortError(signal.reason) : e
    }

    if (
      !resp.ok ||
      !resp.headers.get('content-type')?.includes('text/event-stream') ||
      !resp.body
    ) {
      throw new Error(`SSE open failed: ${resp.status}`)
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf8')
    let buffer = ''
    this._readyState = this.OPEN

    // Control hello timeout after connection established
    let helloReceived = false
    let timedOut = false
    let helloTimer: ReturnType<typeof setTimeout> | undefined
    if (this.options.timeoutMs && this.options.timeoutMs > 0) {
      helloTimer = setTimeout(() => {
        if (!helloReceived) {
          timedOut = true
          this.close('SSE hello timeout')
        }
      }, this.options.timeoutMs)
    }

    const dispatch = (evt?: string, data?: string, id?: string) => {
      if (data === undefined) {
        return
      }

      const payload = { id, event: evt, data }
      if (evt === 'hello') {
        helloReceived = true
        if (helloTimer) {
          clearTimeout(helloTimer)
        }
      }
      if (evt && this.handlers[evt]) {
        this.handlers[evt](payload)
        return
      }
      if (this.handlers.message) {
        this.handlers.message(payload)
      }
    }

    let event: string | undefined
    let data: string[] = []
    let id: string | undefined

    const flush = () => {
      if (data.length > 0) {
        dispatch(event, data.join('\n'), id)
      }
      event = undefined
      data = []
      id = undefined
    }

    const parseAndEmit = () => {
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line === '') {
          flush()
          continue
        }
        if (line.startsWith(':')) {
          continue
        } // comment
        const idx = line.indexOf(':')
        const field = idx === -1 ? line : line.slice(0, idx)
        const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
        switch (field) {
          case 'data': {
            data.push(value)
            break
          }
          case 'event': {
            event = value
            break
          }
          case 'id': {
            id = value
            break
          }
          case 'retry': {
            break
          }
          default: {
            break
          }
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: true })
        if (done) {
          buffer += '\n\n'
        }
        parseAndEmit()
        if (done) {
          break
        }
      }
    } catch (e) {
      // A hello timeout is reported once, below.
      if (!timedOut) {
        this.reportReadError(e, signal)
      }
    } finally {
      this.controller = null
      this._readyState = this.CLOSED
      if (helloTimer) {
        clearTimeout(helloTimer)
      }
      // Propagate timeout via error handler instead of throwing across async boundary
      if (timedOut) {
        this.handlers.error?.({ event: 'error', data: 'SSE hello timeout' })
      }
    }
  }

  private reportReadError(e: unknown, signal: AbortSignal) {
    // After close(), fetch rejects with the abort reason (a string here), not an
    // AbortError, so name it for handlers that ignore aborts.
    const err = signal.aborted ? abortError(signal.reason) : ensureError(e)
    this.handlers.error?.({ event: 'error', data: err.message || 'read error', raw_error: err })
  }
}

function abortError(reason: unknown): Error {
  const err = new Error(typeof reason === 'string' ? reason : 'The operation was aborted')
  err.name = 'AbortError'
  return err
}
