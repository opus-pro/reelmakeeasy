#!/usr/bin/env node
/**
 * Builds the preset asset pack: the media presets/story-mode/styles.json (style
 * thumbnails and previews) and demos.json (demo projects) point at, too heavy
 * to keep in git.
 *
 *   node scripts/build-preset-pack.mjs --version=v002 [--src=<dir>[,<dir>…]]
 *
 * --src folders are searched in order; the default is the installed current
 * pack, then .reelmakeeasy/presets-src (where new or original files go).
 *
 * Reads each asset from --src (paths as written in the catalogs), standardizes it
 * and stores it under a stable name:
 *   story-mode/styles/<style>.webp|.webm   WebP <= 960px tall; VP9 <= 888px, no audio
 *   demo-projects/<project>/video.webm     VP9 <= 1280px tall, Opus audio
 *   demo-projects/<project>/*.webp         thumbnails, as above
 *   demo-projects/<project>/audio.*, assets/*   copied as-is (remix inputs)
 *   render/*                               copied as-is (fonts and the template
 *                                          snapshot the video render reads)
 *   editor/*                               copied as-is (the editor's preview engine
 *                                          and its font bundle)
 *   camera-samples/<id>.mp4|.jpg           copied as-is (a sample clip and poster per
 *                                          camera style: dynamic, calm, beat-loop)
 *   LICENSES/*                             from presets/LICENSES (licences and
 *                                          provenance of the bundled media)
 * and writes:
 *   .reelmakeeasy/pack-build/<version>/            the unpacked pack (use it as
 *                                                 --src for the next build)
 *   .reelmakeeasy/pack-build/<asset>.tar.gz         the archive to upload
 *   presets/story-mode/{styles,demos}.json        asset paths renamed
 *   presets/pack.json                             version, release, sha256
 *
 * Then upload the archive as a release asset (see presets/README.md).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRESETS = path.join(ROOT, 'presets')
const CATALOG = path.join(PRESETS, 'story-mode/styles.json')
const DEMOS = path.join(PRESETS, 'story-mode/demos.json')
const PACK_FILE = path.join(PRESETS, 'pack.json')
const REPO = 'opus-pro/reelmakeeasy'
const THUMB_MAX_HEIGHT = 960
const VIDEO_MAX_HEIGHT = 888
const DEMO_VIDEO_MAX_HEIGHT = 1280
// Files shipped byte for byte. The render ones must match RENDER_PRESETS in
// libs/shared/common/src/storage/presets.ts, the editor ones the paths in
// apps/web/next.config.js and StoryRenderPlanBuilder.ts, the camera samples
// CAMERA_SAMPLES in libs/shared/common/src/storage/camera-samples.ts (its test
// checks this list).
const COPIED_FILES = [
  'render/fonts.tar.gz',
  'render/current_template_snapshot.json',
  'editor/AVEditorEngine.wasm.gz',
  'editor/storymode_fonts.tar.gz',
  'camera-samples/dynamic.mp4',
  'camera-samples/dynamic.jpg',
  'camera-samples/calm.mp4',
  'camera-samples/calm.jpg',
  'camera-samples/beat-loop.mp4',
  'camera-samples/beat-loop.jpg',
]

const flag = (name) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=')
const version = flag('version')
if (!version || !/^v\d{3}$/.test(version)) {
  console.error(
    'Usage: node scripts/build-preset-pack.mjs --version=v<NNN> (e.g. v002) [--src=<dir>]',
  )
  process.exit(1)
}
const currentPack = JSON.parse(fs.readFileSync(PACK_FILE, 'utf8')).version
const srcDirs = (flag('src') ?? `.reelmakeeasy/presets/${currentPack},.reelmakeeasy/presets-src`)
  .split(',')
  .map((dir) => path.resolve(ROOT, dir))
const buildRoot = path.join(ROOT, '.reelmakeeasy/pack-build')
const out = path.join(buildRoot, version)
const asset = `reelmakeeasy-presets-${version}.tar.gz`

const slug = (id) =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function probe(file) {
  const json = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,height',
    '-of',
    'json',
    file,
  ])
  const { streams } = JSON.parse(json)
  const stream = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  return { audioCodec: audio?.codec_name, codec: stream.codec_name, height: stream.height }
}

async function thumbnail(from, to) {
  const { format, height } = await sharp(from).metadata()
  if (format === 'webp' && height <= THUMB_MAX_HEIGHT) return fs.copyFileSync(from, to)
  await sharp(from)
    .resize({ height: THUMB_MAX_HEIGHT, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(to)
}

/** VP9 WebM at most `maxHeight` tall; `keepAudio` re-encodes sound to Opus, otherwise it's dropped. */
function encodeVideo(from, to, { crf, keepAudio, maxHeight }) {
  const { audioCodec, codec, height } = probe(from)
  const videoOk = codec === 'vp9' && height <= maxHeight
  const audioOk = keepAudio ? !audioCodec || audioCodec === 'opus' : !audioCodec
  // Already standard: copy the bytes, so rebuilding an unchanged pack is identical.
  if (videoOk && audioOk && from.endsWith('.webm')) return fs.copyFileSync(from, to)
  const videoArgs = videoOk
    ? ['-c:v', 'copy']
    : [
        '-vf',
        `scale=-2:'min(${maxHeight},ih)'`,
        '-c:v',
        'libvpx-vp9',
        '-crf',
        String(crf),
        '-b:v',
        '0',
        '-row-mt',
        '1',
        '-pix_fmt',
        'yuv420p',
      ]
  const audioArgs = keepAudio ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-an']
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', from, ...videoArgs, ...audioArgs, to])
}

const video = (from, to) =>
  encodeVideo(from, to, { crf: 36, keepAudio: false, maxHeight: VIDEO_MAX_HEIGHT })
const demoVideo = (from, to) =>
  encodeVideo(from, to, { crf: 33, keepAudio: true, maxHeight: DEMO_VIDEO_MAX_HEIGHT })
const copy = (from, to) => fs.copyFileSync(from, to)

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))
const demos = JSON.parse(fs.readFileSync(DEMOS, 'utf8'))
fs.rmSync(out, { force: true, recursive: true })

const done = new Map() // source path -> pack path, so shared assets are encoded once
/** Encodes obj[field] (a path under --src) to `to` in the pack and points obj[field] at it. */
async function convert(obj, field, to, encode) {
  const from = obj[field]
  if (!from) return
  if (!done.has(from)) {
    const input = srcDirs.map((dir) => path.join(dir, from)).find((file) => fs.existsSync(file))
    if (!input) throw new Error(`${field} ${from} not found in ${srcDirs.join(', ')}`)
    fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true })
    await encode(input, path.join(out, to))
    done.set(from, to)
    console.log(`  ${to}`)
  }
  obj[field] = done.get(from)
}

console.log(`Building ${version} from ${srcDirs.map((dir) => path.relative(ROOT, dir)).join(', ')}`)
for (const style of [...catalog.styles, ...catalog.songStyles]) {
  const base = `story-mode/styles/${slug(style.id)}`
  await convert(style, 'thumbnailUrl', `${base}.webp`, thumbnail)
  await convert(style, 'previewVideoUrl', `${base}.webm`, video)
}
for (const demo of demos.demos) {
  const base = `demo-projects/${slug(demo.projectId)}`
  await convert(demo, 'resultVideo', `${base}/video.webm`, demoVideo)
  await convert(demo, 'thumbnail', `${base}/thumbnail.webp`, thumbnail)
  await convert(demo, 'styleThumbnailUrl', `${base}/style-thumbnail.webp`, thumbnail)
  if (demo.audioUrl)
    await convert(
      demo,
      'audioUrl',
      `${base}/audio${path.extname(demo.audioUrl).toLowerCase()}`,
      copy,
    )
  for (const [i, a] of (demo.assets ?? []).entries()) {
    const ext = path.extname(a.url).toLowerCase()
    await convert(
      a,
      'url',
      // Strip a previous build's index prefix so rebuilding keeps the same name.
      `${base}/assets/${i + 1}-${slug(path.basename(a.url, path.extname(a.url)).replace(/^\d+-/, ''))}${ext}`,
      copy,
    )
  }
}

for (const file of COPIED_FILES) {
  const holder = { file }
  await convert(holder, 'file', file, copy)
}

// Licences and provenance of the bundled media ship with the pack.
fs.cpSync(path.join(PRESETS, 'LICENSES'), path.join(out, 'LICENSES'), { recursive: true })
console.log('  LICENSES/')

const archive = path.join(buildRoot, asset)
const roots = fs.readdirSync(out).sort()
// No builder's user name, group or macOS extended attributes in the archive
// (bsdtar on macOS, GNU tar elsewhere).
const tarFlags =
  process.platform === 'darwin'
    ? [
        '--uid',
        '0',
        '--gid',
        '0',
        '--uname',
        'root',
        '--gname',
        'root',
        '--no-xattrs',
        '--no-mac-metadata',
      ]
    : ['--owner=0', '--group=0', '--numeric-owner']
execFileSync('tar', [...tarFlags, '-czf', archive, '-C', out, ...roots], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
})
const bytes = fs.statSync(archive).size
const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')

fs.writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`)
fs.writeFileSync(DEMOS, `${JSON.stringify(demos, null, 2)}\n`)
const pack = { version, repo: REPO, tag: `presets-${version}`, asset, bytes, sha256 }
fs.writeFileSync(PACK_FILE, `${JSON.stringify(pack, null, 2)}\n`)

console.log(
  `\n${done.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${path.relative(ROOT, archive)}`,
)
console.log(`sha256 ${sha256}`)
console.log(
  `Upload: gh release create ${pack.tag} ${path.relative(ROOT, archive)} -R ${REPO} --title "Preset pack ${version}"`,
)
