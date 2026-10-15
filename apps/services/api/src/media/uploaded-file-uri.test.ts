import { HOSTILE_KEYS, HOSTILE_STORE_URIS } from '@reelmakeeasy/common/storage/address.cases'
import { BadRequestException } from '@nestjs/common'

import { resolveUploadedFileUri } from './uploaded-file-uri'

describe('resolveUploadedFileUri', () => {
  it('accepts a stored file, as an address or a bare key', () => {
    expect(resolveUploadedFileUri('store://projects/p1/user_uploaded/a b.mp4')).toBe(
      'store://projects/p1/user_uploaded/a b.mp4',
    )
    expect(resolveUploadedFileUri('tmp/u1/story-mode-audio/1-a.mp3')).toBe(
      'store://tmp/u1/story-mode-audio/1-a.mp3',
    )
  })

  it.each([
    ['a key that climbs out of the stored files', 'store://../file-signing.key'],
    ['an encoded climb', 'store://%2E%2E/kv.json'],
    ['a dot segment in the key', 'store://tmp/u1/../../projects/p2/a.mp4'],
    ['an encoded dot segment', 'store://tmp/u1/%2e%2e/a.mp4'],
    ['a double-encoded dot segment', 'store://tmp/u1/%252e%252e/a.mp4'],
    ['a hidden segment', 'store://tmp/u1/.meta/a.mp4'],
    ['a bare key that climbs', '../file-signing.key'],
    ['a backslash', String.raw`store://tmp\..\a.mp4`],
    ['an empty key', 'store://'],
    ['malformed encoding', 'store://a%E0%A4%A.mp4'],
  ])('rejects %s', (_label, input) => {
    expect(() => resolveUploadedFileUri(input)).toThrow(BadRequestException)
  })

  it.each([...HOSTILE_KEYS, ...HOSTILE_STORE_URIS.filter((uri) => uri.startsWith('store://'))])(
    'rejects %j from the shared table',
    (input) => {
      expect(() => resolveUploadedFileUri(input)).toThrow(BadRequestException)
    },
  )
})
