import path from 'node:path'

import { presetsDir } from '@reelmakeeasy/common/storage/presets'

export const MUSIC_COMPOSER_SKILL_NAME = 'reelmakeeasy-music-composer'

/**
 * The `reelmakeeasy-music-composer` skill: how the agent composes a Motion Reel's music note by
 * note with the composer (`tools/motion-composer`). Unlike the rendered skills it is checked in as
 * a folder, `skills/reelmakeeasy-music-composer/` (SKILL.md and its references), and copied whole
 * into the agent's skills at every session start.
 */
export function musicComposerSkillDir(): string {
  return path.join(path.dirname(presetsDir()), 'skills', MUSIC_COMPOSER_SKILL_NAME)
}
