// Guards the public repo against internal leftovers coming back: company
// domains and infrastructure, ticket ids, personal home paths, internal
// workspace, design-file and service names, hosted project ids, trial-licensed
// fonts, analytics SDKs, self-hosted CI runners, real user ids in the presets, and
// the hosted product's storage: Google Cloud Storage names, `gs://` addresses and buckets.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const BINARY = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.mp3',
  '.mp4',
  '.wav',
  '.webm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.riv',
  '.lottie',
  '.gz',
  '.tgz',
  '.zip',
  '.wasm',
  '.pdf',
])

/** Tracked text files, minus the lockfile (package names only) and this test. */
function trackedTextFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !BINARY.has(extname(file).toLowerCase()))
    .filter((file) => file !== 'pnpm-lock.yaml' && file !== 'scripts/repo-hygiene.test.mjs')
}

function findHits(pattern, { allow = () => false } = {}) {
  const hits = []
  for (const file of trackedTextFiles()) {
    let text
    try {
      text = readFileSync(`${ROOT}${file}`, 'utf8')
    } catch {
      continue // listed but missing in the working tree (e.g. mid-rebase)
    }
    text.split('\n').forEach((line, index) => {
      if (pattern.test(line) && !allow(file, line))
        hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`)
    })
  }
  return hits
}

test('no company domains or hosted infrastructure', () => {
  // A real contact address may live in the policy files and the licensing files.
  const contactFiles = ['SECURITY.md', 'CODE_OF_CONDUCT.md', 'README.md', 'NOTICE', 'CLA.md']
  const allow = (file, line) => contactFiles.includes(file) && /\b[\w.+-]+@opus\.pro\b/.test(line)
  const hits = findHits(
    /opus\.pro\b|opuslab\.ai|opus-runner|opus-platform-x|pkg\.dev\/opus|prod-ao-ext|stg-opus/i,
    { allow },
  )
  assert.deepEqual(hits, [])
})

test('no internal ticket ids', () => {
  assert.deepEqual(findHits(/\b(?:AO|PLA|SEC|LABS|GROW)-\d+\b|linear\.app\//), [])
})

test('no personal home paths', () => {
  // Not inside a longer path (`@/app/home/...`). The neutral `u` and
  // Emscripten's `web_user` are the placeholders tests and the engine use.
  const homePath = /(?<![\w@.~/-])\/(?:Users?|home)\/([A-Za-z][\w.-]*)/g
  const hits = findHits(/(?<![\w@.~/-])\/(?:Users?|home)\/[A-Za-z]/).filter((hit) =>
    [...hit.matchAll(homePath)].some((match) => !['u', 'web_user'].includes(match[1])),
  )
  assert.deepEqual(hits, [])
})

test('no internal workspace links', () => {
  assert.deepEqual(findHits(/\blark\b|feishu|larksuite/i), [])
})

test('no design-file keys', () => {
  assert.deepEqual(findHits(/figma\.com\/(?:file|design)\/[A-Za-z0-9]+/i), [])
})

test('no internal repo or service names', () => {
  assert.deepEqual(
    findHits(/\b(?:clip-(?:api|engine|apps|web)|montage-agent)\b|\bOC(?:-SSO|'s)\b/i),
    [],
  )
})

test('no hosted project or session ids', () => {
  // The hosted id shape (MMDDHHMM-xxx) next to the word that says where it came from,
  // e.g. "prod 01010000-abc" or "session 01010000-abc".
  assert.deepEqual(
    findHits(/\b(?:prod|staging|lane|session|project)\b.{0,24}?\b\d{8}-[a-z0-9]{3}\b/i),
    [],
  )
})

test('no trial-licensed fonts', () => {
  assert.deepEqual(findHits(/targa/i), [])
})

test('no analytics or monitoring SDKs', () => {
  assert.deepEqual(
    findHits(
      /from ['"](?:@datadog\/|statsig|@statsig\/|mixpanel|@sentry\/|dd-trace)|require\(['"](?:dd-trace|mixpanel|statsig)/,
    ),
    [],
  )
})

test('CI runs on GitHub-hosted runners', () => {
  const hits = findHits(/^\s*runs-on:/).filter((hit) => hit.startsWith('.github/'))
  assert.notEqual(hits.length, 0)
  for (const hit of hits) {
    // Every runner the file names must be GitHub-hosted; any other runner
    // comes from the CI_RUNNER repository variable, outside the code.
    const named = hit.includes('${{')
      ? [...hit.matchAll(/'([^']*)'/g)].map((match) => match[1])
      : [hit.replace(/^.*runs-on:\s*/, '').trim()]
    assert.notEqual(named.length, 0, hit)
    for (const runner of named) assert.match(runner, /^(?:ubuntu|macos|windows)-/, hit)
  }
})

test('no Google storage names or gs:// addresses', () => {
  // Stored files are `store://<key>` (libs/shared/common/src/storage/address.ts).
  const googleStorage =
    /gs:\/\/|gcs|gsutil|storage\.googleapis\.com|storage\.cloud\.google\.com|@google-cloud\/storage/i
  // A YouTube video id is random letters and can spell `gcs` (the README's example Shorts).
  const youtubeIds = /(youtube\.com\/shorts\/|youtu\.be\/|i\.ytimg\.com\/vi\/)[\w-]{11}/g
  const allow = (_file, line) => !googleStorage.test(line.replace(youtubeIds, '$1'))
  assert.deepEqual(findHits(googleStorage, { allow }), [])
  // Names built on `Gs` (`destGsUri`, `convertGsToCdn`, `oldGs`) and the storage mount the
  // hosted product read files through.
  assert.deepEqual(findHits(/[a-z]Gs[A-Z]|\bGs[A-Z]|[a-z]Gs\b|\bFUSE\b|legacy.bucket/), [])
})

test('no storage buckets', () => {
  // One folder of stored files, addressed by key: no bucket names, constants or routes.
  assert.deepEqual(
    findHits(
      /\bWORKSPACE_BUCKET|\bbucketV2\b|\bBUCKET_NAME\b|\.bucket\(|getStorage\(\)|files\/:bucket|toCurrentWorkspaceBucket|api\/files\/reelmakeeasy\//,
    ),
    [],
  )
})

test('no retired address schemes or project root', () => {
  // Pasted files are `pasted://`, caption presets `caption-preset://`, and a project's
  // files live under `projects/<id>/` (the cache-key test names the old root on purpose).
  const allow = (file) => file === 'libs/shared/common/src/storage/address-cache-keys.test.ts'
  // The editor engine's own caption-preset scheme, which the preview must hand it.
  const engineScheme = (file) =>
    file === 'apps/web/src/app/projects/[projectId]/editor/render-engine-sdk/engine-plan-json.ts' ||
    file ===
      'apps/web/src/app/projects/[projectId]/editor/render-engine-sdk/engine-plan-json.test.ts'
  assert.deepEqual(findHits(/opus-media:|opus:\/\//, { allow: engineScheme }), [])
  assert.deepEqual(findHits(/(?<![\w.-])ao\/(?:\$\{|<|\{|p\d)/, { allow }), [])
})

test('presets carry no real user or project ids', () => {
  assert.deepEqual(
    findHits(/"source(?:User|Project)Id"\s*:/).filter((hit) => hit.startsWith('presets/')),
    [],
  )
})
