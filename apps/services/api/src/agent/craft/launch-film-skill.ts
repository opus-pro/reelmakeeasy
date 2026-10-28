import path from 'node:path'

import { presetsDir } from '@reelmakeeasy/common/storage/presets'

export const LAUNCH_FILM_SKILL_NAME = 'reelmakeeasy-launch-film'

/**
 * The `reelmakeeasy-launch-film` skill: the owner's quality bar for a Motion Reel, measured from a
 * 60 s launch film they picked (its story arc, music arc, joins, scene layout and pacing, scaled to
 * 15, 30 and 60 s). Checked in as a folder, `skills/reelmakeeasy-launch-film/` (SKILL.md and the
 * measured breakdown in its references), and copied whole into the agent's skills at every session
 * start, like the music composer skill.
 */
export function launchFilmSkillDir(): string {
  return path.join(path.dirname(presetsDir()), 'skills', LAUNCH_FILM_SKILL_NAME)
}
