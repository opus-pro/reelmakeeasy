import { filePath } from '@reelmakeeasy/common/storage/file-store'
import { projectRootKey } from '@reelmakeeasy/common/storage/stored-files'

/** The local folder of a project's files (`store://projects/<id>` on disk), linked into a
 *  chat's working folder as `project` so Codex can read the finished video's files. */
export function projectFolder(projectId: string): string {
  return filePath(projectRootKey(projectId))
}
