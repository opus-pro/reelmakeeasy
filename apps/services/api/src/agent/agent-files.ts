import fs from 'node:fs'
import path from 'node:path'

import { agentCodexHome } from './codex/codex-home'

const IMAGE_EXT = new Set(['.jpeg', '.jpg', '.png', '.webp'])

function realpathOrNull(p: string): null | string {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/** Codex's generated_images folder in the agent Codex home. */
export function codexGeneratedImagesDir(home: string = agentCodexHome()): string {
  return path.join(home, 'generated_images')
}

/** Whether `resolveAllowedImagePath` accepts `p`. */
export function isAllowedImagePath(
  p: string,
  sessionDir: string,
  imagesDir: string = codexGeneratedImagesDir(),
): boolean {
  return resolveAllowedImagePath(p, sessionDir, imagesDir) !== null
}

/** Chat images: only Codex's generated_images folder or this session's folder.
 *  Resolves symlinks (via realpath) before the containment check, so a
 *  symlink that sits inside an allowed root but points outside it (or at a
 *  non-image) is refused rather than followed. Returns the resolved path -
 *  the one to serve, so what is sent is exactly what was checked - or null. */
export function resolveAllowedImagePath(
  p: string,
  sessionDir: string,
  imagesDir: string = codexGeneratedImagesDir(),
): null | string {
  return resolveImageUnder(p, [imagesDir, path.resolve(sessionDir)])
}

/** A picture (by extension) under one of `roots`, checked as `resolveAllowedImagePath` checks
 *  it: the real path, symlinks resolved, must lie inside a root's real path. Returns that real
 *  path, or null (a relative path, a missing file, a root that doesn't exist, not a picture). */
export function resolveImageUnder(p: string, roots: string[]): null | string {
  if (!path.isAbsolute(p) || !IMAGE_EXT.has(path.extname(p).toLowerCase())) return null
  const resolved = realpathOrNull(p)
  if (!resolved || !IMAGE_EXT.has(path.extname(resolved).toLowerCase())) return null
  const real = roots.map(realpathOrNull).filter((root): root is string => root !== null)
  return real.some((root) => resolved.startsWith(root + path.sep)) ? resolved : null
}

/** A video's file as the agent sees it, under its working folder's `project` link: a stored
 *  file's address (`store://.../projects/<id>/long_take/...` or a page URL) from `long_take/` on, or
 *  null for one outside it. A clip made again and a new keyframe picture get new names, so the
 *  address on record, not the old name, says which file is current. */
export function projectFilePath(uri: string | undefined): null | string {
  const at = uri?.indexOf('/long_take/') ?? -1
  return uri && at >= 0 ? `project${uri.slice(at)}` : null
}
