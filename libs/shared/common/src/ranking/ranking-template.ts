import type {
  RankingProject,
  RankingProjectPatch,
  RankingTemplate,
  RankingTemplateSound,
  RankingTitle,
} from '@shared/types/api/ranking'

import { DEFAULT_RANKING_TITLE, emptyItems, revealOrder } from './ranking-project'

/** Every library sound a style's plan names (to check they still exist). */
export function templateSoundIds(template: Pick<RankingTemplate, 'sounds'>): string[] {
  const { music, onAction, reveal, transition } = template.sounds
  return [music, reveal, transition, ...onAction].flatMap((s) => (s?.soundId ? [s.soundId] : []))
}

/** The sounds a style plans that aren't in the library yet: the user's download list. */
export function missingTemplateSounds(template: Pick<RankingTemplate, 'sounds'>): RankingTemplateSound[] {
  const { music, onAction, reveal, transition } = template.sounds
  return [...onAction, reveal, transition, music].filter(
    (s): s is RankingTemplateSound => !!s && !s.soundId,
  )
}

const sameTitle = (a: RankingTitle, b: RankingTitle) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The title in the style's colours: a ranking still on the default title takes the style's
 * title whole; one with its own words keeps them and takes the colours word by word (a line
 * longer than the style's repeats its last colour).
 */
function styledTitle(current: RankingTitle, template: RankingTitle): RankingTitle {
  if (sameTitle(current, DEFAULT_RANKING_TITLE)) return structuredClone(template)
  return {
    band: template.band,
    lines: current.lines.map((line, i) => {
      const pattern = template.lines[Math.min(i, template.lines.length - 1)] ?? []
      return line.map((word, j) => ({
        ...word,
        color: pattern[Math.min(j, pattern.length - 1)]?.color ?? word.color,
      }))
    }),
  }
}

/**
 * The changes that give a ranking a style's look and sound: title colours, overlay colours,
 * reveal mode, transition and the reveal/music sounds. A ranking with no clips yet also takes
 * the style's number of ranks. Labels, trims, action sounds and stickers depend on the clips:
 * the agent (or the user) places those.
 */
export function applyRankingTemplate(project: RankingProject, template: RankingTemplate): RankingProjectPatch {
  const noClips = project.items.every((item) => !item.clip)
  const items = noClips && project.items.length !== template.rankCount ? emptyItems(template.rankCount) : project.items
  return {
    ...(items === project.items ? {} : { items }),
    reveal: { mode: template.reveal, order: revealOrder(template.reveal, items.length, project.reveal.order) },
    sounds: {
      music: template.sounds.music?.soundId ?? null,
      musicVolume: template.sounds.musicVolume,
      reveal: template.sounds.reveal?.soundId ?? null,
    },
    style: structuredClone(template.style),
    title: styledTitle(project.title, template.title),
    transition: { ...template.transition, sound: template.sounds.transition?.soundId ?? null },
  }
}
