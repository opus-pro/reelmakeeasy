// Read with dot access so the web build inlines it (Next.js only replaces
// `process.env.NEXT_PUBLIC_*` written that way).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      NEXT_PUBLIC_API_ORIGIN?: string
    }
  }
}

/**
 * Addresses of stored files. Browser-safe: no Node imports.
 *
 * A stored file is named by its key, a relative `/`-separated path such as
 * `projects/<projectId>/long_take/kf-01.png`, and addressed as `store://<key>`.
 * The scheme tells a stored file apart from a project-relative path, an http(s)
 * URL, a `blob:`/`data:` URL or a local path, so saved data holds the address and
 * never a served URL: the URL (with its host and port) is built when data is sent
 * to a browser (`storeUriToUrl`, `serveStoredUrls`).
 *
 * This file is the one parser. Every check that a client-supplied address stays
 * inside a folder goes through `parseStoreUri` (or `urlToStoreUri`) and then
 * `keyIsUnder`, never through a raw string prefix.
 */

export const STORE_SCHEME = 'store://'

export type StoreUri = `store://${string}`

/** Thrown for an address or key that is malformed or leaves the stored files. */
export class InvalidStoreUriError extends Error {
  constructor(value: string) {
    super(`Invalid stored file address: ${JSON.stringify(value.slice(0, 300))}`)
    this.name = 'InvalidStoreUriError'
  }
}

export function isStoreUri(value: unknown): value is StoreUri {
  return typeof value === 'string' && value.startsWith(STORE_SCHEME)
}

/**
 * Still encoded after one decode (a dot, slash or backslash): a second decode
 * anywhere downstream would turn it into a path step.
 */
const LEFTOVER_ESCAPE = /%(?:2e|2f|5c)/i

/** Whether `key` is a plain stored-file key (see `checkStoreKey`). */
export function isStoreKey(key: string): boolean {
  if (!key || key.includes('\\') || key.includes('\0') || LEFTOVER_ESCAPE.test(key)) return false
  // Every segment is non-empty and not hidden: no `..`, `.`, `.meta`, `.DS_Store`.
  return key.split('/').every((segment) => segment !== '' && !segment.startsWith('.'))
}

/**
 * Returns `key` when it is a plain stored-file key: relative, `/`-separated, with
 * no empty, `.`/`..` or dot-led segment, no backslash or NUL, and nothing still
 * percent-encoded that a second decode would turn into a path step.
 */
export function checkStoreKey(key: string): string {
  if (!isStoreKey(key)) throw new InvalidStoreUriError(key)
  return key
}

/** The address of the stored file at `key`. A literal `%` is escaped so it reads back. */
export function storeUri(key: string): StoreUri {
  return `${STORE_SCHEME}${checkStoreKey(key).replace(/%/g, '%25')}`
}

/** The key of a `store://` address, decoded once and checked. */
export function parseStoreUri(value: string): string {
  if (!isStoreUri(value)) throw new InvalidStoreUriError(value)
  let key: string
  try {
    key = decodeURIComponent(value.slice(STORE_SCHEME.length))
  } catch {
    throw new InvalidStoreUriError(value)
  }
  if (!isStoreKey(key)) throw new InvalidStoreUriError(value)
  return key
}

/** Like `parseStoreUri`, but undefined instead of throwing. */
export function storeKeyOf(value: string): string | undefined {
  try {
    return parseStoreUri(value)
  } catch {
    return undefined
  }
}

/** Whether `key` lies inside the folder `prefix` (with or without its trailing slash). */
export function keyIsUnder(key: string, prefix: string): boolean {
  const folder = prefix.replace(/\/+$/, '')
  return isStoreKey(key) && isStoreKey(folder) && key.startsWith(`${folder}/`)
}

/**
 * Where the API serves stored files, e.g. `http://localhost:5017/api/files`. The
 * server reads PUBLIC_FILES_URL, the web app NEXT_PUBLIC_API_ORIGIN (inlined at
 * build time), and both default to the local API on PORT.
 */
export function filesBaseUrl(): string {
  const env = typeof process === 'undefined' ? undefined : process.env
  const filesUrl = env?.['PUBLIC_FILES_URL']
  if (filesUrl) return filesUrl.replace(/\/+$/, '')
  const apiOrigin =
    (typeof process === 'undefined' ? undefined : process.env.NEXT_PUBLIC_API_ORIGIN) ||
    `http://localhost:${env?.['PORT'] || 5017}`
  return `${apiOrigin.replace(/\/+$/, '')}/api/files`
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/')

/** The URL a browser loads the stored file at `key` from. */
export function storeKeyToUrl(key: string): string {
  return `${filesBaseUrl()}/${encodeKey(checkStoreKey(key))}`
}

/**
 * The served URL of a `store://` address; any other value (or an address the parser
 * refuses) is returned unchanged, so rendering a bad value never throws.
 */
export function storeUriToUrl<T extends string>(value: T): string | T {
  const key = isStoreUri(value) ? storeKeyOf(value) : undefined
  return key === undefined ? value : storeKeyToUrl(key)
}

/**
 * The key behind a URL this app serves a stored file from (`<filesBaseUrl>/<key>`),
 * decoded once and checked, or undefined for any other URL. Stored files are the
 * only images and media a client may point a record at.
 */
export function storedFileKey(url: string): string | undefined {
  const base = `${filesBaseUrl()}/`
  if (!url.startsWith(base)) return undefined
  let key: string
  try {
    key = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0] ?? '')
  } catch {
    return undefined
  }
  return isStoreKey(key) ? key : undefined
}

/** The address behind a served stored-file URL (query and fragment dropped), or undefined. */
export function urlToStoreUri(url: string): StoreUri | undefined {
  const key = storedFileKey(url)
  return key === undefined ? undefined : storeUri(key)
}

/** The address behind a served stored-file URL; any other value is returned unchanged. */
export function asStoreUri<T extends null | string | undefined>(value: T): string | T {
  return (typeof value === 'string' && urlToStoreUri(value)) || value
}

/**
 * Preset files (style previews, music, voice samples) are served by the API's presets
 * route, next to the files route. Saved data names one as `preset://<key>`, so it holds
 * no host or port either; `<key>` is the path the presets route takes
 * (`<pack version>/<path>` for the installed pack).
 */
export const PRESET_SCHEME = 'preset://'

export function isPresetUri(value: unknown): value is `preset://${string}` {
  return typeof value === 'string' && value.startsWith(PRESET_SCHEME)
}

/** Where the API serves preset files: the files route's sibling, `<api>/api/presets`. */
export function presetsBaseUrl(): string {
  return filesBaseUrl().replace(/\/files$/, '/presets')
}

/** The served URL of a `preset://` address; any other value is returned unchanged. */
export function presetUriToUrl<T extends string>(value: T): string | T {
  if (!isPresetUri(value)) return value
  let key: string
  try {
    key = decodeURIComponent(value.slice(PRESET_SCHEME.length))
  } catch {
    return value
  }
  return isStoreKey(key) ? `${presetsBaseUrl()}/${encodeKey(key)}` : value
}

/**
 * What saved data keeps for a URL this app serves: `store://<key>` for a stored file,
 * `preset://<key>` for a preset file. Anything else (another site's URL, an address) is
 * returned unchanged. Applied where a URL a client sends back is saved.
 */
export function toSavedAddress<T extends null | string | undefined>(value: T): string | T {
  if (typeof value !== 'string') return value
  const stored = urlToStoreUri(value)
  if (stored) return stored
  const base = `${presetsBaseUrl()}/`
  if (!value.startsWith(base)) return value
  let key: string
  try {
    key = decodeURIComponent(value.slice(base.length).split(/[?#]/)[0] ?? '')
  } catch {
    return value
  }
  return isStoreKey(key) ? `${PRESET_SCHEME}${key.replace(/%/g, '%25')}` : value
}

/** The served URL of a `store://` or `preset://` address; anything else is returned unchanged. */
export function addressToUrl<T extends string>(value: T): string | T {
  return presetUriToUrl(storeUriToUrl(value))
}

/**
 * `key` as it sits in free text: every segment percent-encoded, with the characters
 * `encodeURIComponent` leaves (`!'()*`) encoded too, so the address or URL ends where
 * the markup around it (a `)` or `|` of a tag, a space) begins. Reads back with one decode.
 */
const encodeKeyForText = (key: string) =>
  key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/')

/** The scheme and key of a `store://` or `preset://` address, decoded once and checked. */
function addressParts(value: string): undefined | { key: string; scheme: string } {
  const scheme = isStoreUri(value) ? STORE_SCHEME : isPresetUri(value) ? PRESET_SCHEME : undefined
  if (!scheme) return undefined
  let key: string
  try {
    key = decodeURIComponent(value.slice(scheme.length))
  } catch {
    return undefined
  }
  return isStoreKey(key) ? { key, scheme } : undefined
}

/**
 * A `store://` or `preset://` address in the form it takes inside text (see
 * `encodeKeyForText`); anything else is returned unchanged. Both forms read back as the
 * same file.
 */
export function addressForText(value: string): string {
  const parts = addressParts(value)
  return parts ? `${parts.scheme}${encodeKeyForText(parts.key)}` : value
}

/**
 * An upload's tag in text a user typed, `@img[<label>](<id>|<url>)` (or `@video`, `@audio`,
 * ...), whose URL may hold one level of parentheses (a file named `My-Song (1).mp4`).
 * Groups: the tag up to the URL, and the URL.
 */
const ASSET_TAG =
  /(@(?:vo|img|video|audio|txt|pdf|file|shot)\[(?:\[[^[\]\n]*\]|[^\]\n])*\]\([^)|\n]+\|)((?:[^()\n]|\([^)\n]*\))*)\)/g

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

/** The stop characters of a URL or an address written bare in text. */
const BARE_END = String.raw`\s|)\]"'<>`

/**
 * Free text a user typed (a chat message, a prompt) with every URL this app serves a
 * stored or preset file from replaced by the file's address (`store://<key>`,
 * `preset://<key>`), encoded so it stays one token; a served query is dropped. Applied
 * where such text is saved: an upload's tag keeps the file's address, never a host or
 * port, and the browser builds the URL as it shows the text (`addressesInTextToUrls`).
 * A URL that does not name a stored file (another site's, or one that climbs out) is
 * left as it is.
 */
export function toSavedAddressesInText<T extends null | string | undefined>(text: T): string | T {
  if (!text) return text
  const files = `${filesBaseUrl()}/`
  const presets = `${presetsBaseUrl()}/`
  if (!text.includes(files) && !text.includes(presets)) return text
  const saved = (url: string) => {
    const address = toSavedAddress(url)
    return address === url ? url : addressForText(address)
  }
  const bare = new RegExp(
    `(?:${escapeRegExp(files)}|${escapeRegExp(presets)})[^?#${BARE_END}]*(?:[?#][^${BARE_END}]*)?`,
    'g',
  )
  return text
    .replace(ASSET_TAG, (whole, head: string, url: string) => {
      const address = saved(url)
      return address === url ? whole : `${head}${address})`
    })
    .replace(bare, saved)
}

/**
 * The inverse of `toSavedAddressesInText`, for text sent to the browser: every address in
 * an upload's tag, or written bare, becomes the URL the file is served from now. An
 * address the parser refuses is left as it is.
 */
export function addressesInTextToUrls<T extends null | string | undefined>(text: T): string | T {
  if (!text || (!text.includes(STORE_SCHEME) && !text.includes(PRESET_SCHEME))) return text
  const served = (value: string) => {
    const parts = addressParts(value)
    if (!parts) return value
    const base = parts.scheme === STORE_SCHEME ? filesBaseUrl() : presetsBaseUrl()
    return `${base}/${encodeKeyForText(parts.key)}`
  }
  return text
    .replace(ASSET_TAG, (whole, head: string, value: string) => {
      const url = served(value)
      return url === value ? whole : `${head}${url})`
    })
    .replace(new RegExp(`(?:store|preset)://[^${BARE_END}]+`, 'g'), served)
}

/**
 * Fields that hold a URL a browser loads: `*Url`, `*Urls`, `*_url`, `url`, `*Thumbnail`
 * and the delivered videos. Address fields (`*Uri`, `*Path`, `file_path`) stay
 * addresses: the client sends those back.
 */
const URL_FIELD =
  /(?:^urls?|Urls?|URLs?|_urls?|^thumbnail|Thumbnail)$|^(?:resultVideo\w*|watermarkVideo)$/

/**
 * A copy of `body` where every `store://` or `preset://` address in a URL field (at any
 * depth) is replaced by its served URL, and so is every address in text (an upload's tag
 * in a message, see `addressesInTextToUrls`); `body` itself when there is nothing to
 * replace. Saved data holds addresses only, so this is applied where data is sent to a
 * browser: no saved record carries a host or port. A malformed address is left as it is
 * rather than failing the whole response, and so is a field that is itself an address
 * (`*Uri`, `*Path`, `file_path`): the client sends those back.
 *
 * `everyField` serves addresses in any field: for a document the browser wrote with
 * URLs throughout and the API keeps only for it (the editor draft).
 */
export function serveStoredUrls<T>(body: T, options: { everyField?: boolean } = {}): T {
  return mapUrlFields(body, addressToUrl, addressesInTextToUrls, options.everyField)
}

/**
 * The inverse of `serveStoredUrls`, for data a client sends back to be saved: every URL
 * this app serves, in a URL field (or, with `everyField`, in any field), becomes its
 * address (`toSavedAddress`), and so does every one in text (`toSavedAddressesInText`).
 */
export function toSavedAddresses<T>(body: T, options: { everyField?: boolean } = {}): T {
  return mapUrlFields(
    body,
    (value) => toSavedAddress(value),
    (value) => toSavedAddressesInText(value),
    options.everyField,
  )
}

/** Whether `value` is itself an address or a URL, rather than text that may hold some. */
const isWholeLink = (value: string) =>
  isStoreUri(value) || isPresetUri(value) || /^https?:\/\/\S*$/.test(value)

function mapUrlFields<T>(
  body: T,
  map: (value: string) => string,
  mapText: (value: string) => string,
  everyField = false,
): T {
  const walk = (value: unknown, urlField: boolean, seen: WeakSet<object>): unknown => {
    if (typeof value === 'string') {
      if (isWholeLink(value)) return urlField ? map(value) : value
      return mapText(value)
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return value
    if (Array.isArray(value)) {
      seen.add(value)
      let changed = false
      const out = value.map((item) => {
        const next = walk(item, urlField, seen)
        changed ||= next !== item
        return next
      })
      return changed ? out : value
    }
    const proto = Object.getPrototypeOf(value) as unknown
    if (proto !== Object.prototype && proto !== null) return value
    seen.add(value)
    let out: Record<string, unknown> | undefined
    for (const [field, item] of Object.entries(value)) {
      const next = walk(item, everyField || URL_FIELD.test(field), seen)
      if (next !== item) {
        out ??= { ...(value as Record<string, unknown>) }
        out[field] = next
      }
    }
    return out ?? value
  }
  return walk(body, everyField, new WeakSet()) as T
}
