import fs from 'node:fs'
import path from 'node:path'

import { dataDir } from '@reelmakeeasy/common/storage/file-store'

import { syncAgentSkills } from '../codex/codex-home'

/** ReelMakeEasy's Claude Code plugin: the skills agent chats on Claude load (the SDK's
 *  `plugins` option). The user's own skills are never loaded (`settingSources: []`). */
export function agentClaudePluginDir(root: string = dataDir()): string {
  return path.join(root, 'claude-plugin')
}

const MANIFEST = {
  description: "ReelMakeEasy's agent-mode skills",
  name: 'reelmakeeasy',
  version: '1.0.0',
}

/** Writes the plugin manifest and the skills: rewritten on every start, stale ones pruned. */
export function ensureClaudePlugin(dir: string = agentClaudePluginDir()): string {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify(MANIFEST, null, 2))
  syncAgentSkills(dir)
  return dir
}
