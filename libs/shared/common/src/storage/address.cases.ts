/**
 * Hostile inputs every stored-file address check must refuse. Shared by the address,
 * file store and API tests so one table covers each containment check.
 */

/** Keys that are empty, absolute, hidden, or climb out of their folder. */
export const HOSTILE_KEYS: readonly string[] = [
  '',
  '..',
  '../kv.json',
  'projects/../../kv.json',
  'projects/p1/../../../file-signing.key',
  '.meta/x.json',
  'projects/p1/.hidden',
  'projects//p1/a.png',
  '/etc/passwd',
  'projects/p1/',
  'projects/./p1/a.png',
  String.raw`projects\..\..\kv.json`,
  'projects/p1/a.png\0',
  // Still encoded after one decode: a second decode anywhere would climb out.
  'projects/p1/%2E%2E/%2E%2E/kv.json',
  'projects%2F..%2F..%2Fkv.json',
  String.raw`projects%5C..%5Ckv.json`,
]

/** Addresses that are malformed, or name something outside the stored files. */
export const HOSTILE_STORE_URIS: readonly string[] = [
  'store://',
  'store://..',
  'store://../kv.json',
  'store://projects/../../kv.json',
  'store://projects/p1/%2E%2E/%2E%2E/kv.json',
  'store://projects%2F..%2F..%2Fkv.json',
  'store://projects/p1/%252E%252E/%252E%252E/kv.json',
  'store://projects%252F..%252F..%252Fkv.json',
  'store://.meta/projects/p1/a.png.json',
  'store:///etc/passwd',
  String.raw`store://projects\..\..\kv.json`,
  'store://projects/p1/a.png%00',
  'store://a%E0%A4%A.png',
  'projects/p1/a.png',
  'https://example.test/api/files/projects/p1/a.png',
  'other://projects/p1/a.png',
]
