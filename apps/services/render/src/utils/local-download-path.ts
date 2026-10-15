import * as crypto from 'node:crypto'
import * as path from 'node:path'

/**
 * Local path a render source URI is downloaded to, within one render.
 *
 * The local name is the URI's basename, because that name is what the render
 * plan references. Two DIFFERENT sources can share a basename, and `download()`
 * finishes by symlinking its cached copy to this path -- so the second source
 * replaces the first one's symlink and every colliding segment then renders the
 * SAME footage.
 *
 * `claimed` maps an already-issued local path to the URI that owns it, so a real
 * collision falls back to a URI-hashed name instead of silently sharing a file.
 * The hash goes in FRONT of the basename to leave the extension intact --
 * callers branch on it (`.tar.gz` extraction, `isVideo`).
 *
 * Only a genuine collision is renamed: a font, template or single-use asset keeps
 * the exact local name it has today. Claiming is synchronous on purpose -- render
 * plan tracks resolve their segments concurrently, so a caller must be able to
 * claim before it awaits the download.
 */
export function resolveLocalDownloadPath(input: {
  claimed: Map<string, string>
  outputDir: string
  uri: string
}): string {
  const { claimed, outputDir, uri } = input
  const basePath = decodeURIComponent(path.resolve(outputDir, path.basename(uri)))
  const owner = claimed.get(basePath)
  if (owner === undefined || owner === uri) {
    claimed.set(basePath, uri)
    return basePath
  }

  const discriminator = crypto.createHash('md5').update(uri).digest('hex').slice(0, 12)
  const disambiguated = path.join(
    path.dirname(basePath),
    `${discriminator}-${path.basename(basePath)}`,
  )
  claimed.set(disambiguated, uri)
  return disambiguated
}
