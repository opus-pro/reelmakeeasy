import { serveHeaders } from './files.controller'

describe('serveHeaders', () => {
  it('serves an SVG sandboxed, so opening it runs no script', () => {
    const headers = serveHeaders('projects/p1/logo.svg')
    expect(headers['Content-Type']).toBe('image/svg+xml')
    expect(headers['Content-Security-Policy']).toContain('sandbox')
    expect(headers['Content-Security-Policy']).toContain("default-src 'none'")
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('leaves other media unrestricted', () => {
    const headers = serveHeaders('projects/p1/final_video.mp4')
    expect(headers['Content-Security-Policy']).toBeUndefined()
    expect(headers['X-Content-Type-Options']).toBeUndefined()
    expect(headers['Cache-Control']).toBe('no-cache')
  })

  it('adds an attachment header for ?download=', () => {
    expect(serveHeaders('a/b.mp4', 'My video.mp4')['Content-Disposition']).toContain(
      'filename="My video.mp4"',
    )
  })
})
