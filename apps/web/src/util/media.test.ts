import { isVideoUri } from './media'

describe('isVideoUri', () => {
  it('reads the extension of a plain video URL', () => {
    expect(isVideoUri('http://localhost:5017/api/files/p/beat_loop_clips.mp4')).toBe(true)
    expect(isVideoUri('http://localhost:5017/api/files/p/still.png')).toBe(false)
  })

  // A loop's joined clips are keyed to their version (`?v=`), so a player loads them again
  // once a render rewrites them: the query is not part of the extension.
  it('ignores a query or fragment after the extension', () => {
    expect(isVideoUri('http://localhost:5017/api/files/p/beat_loop_clips.mp4?v=3')).toBe(true)
    expect(isVideoUri('http://localhost:5017/api/files/p/clip.webm#t=2')).toBe(true)
    expect(isVideoUri('http://localhost:5017/api/files/p/still.png?v=a.mp4')).toBe(false)
  })
})
