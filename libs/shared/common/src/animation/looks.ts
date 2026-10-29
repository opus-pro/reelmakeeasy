import type { AnimationLookId, AnimationStyleId } from '@shared/types/api/agent'

/**
 * Claude Animation's looks: the visual styles Claude draws a narrated short in, every
 * frame in code (Remotion), with no AI video model. Each look has its own skill
 * (`reelmakeeasy-animation-<id>`) with its format and build technique; this card gives the
 * setup card its label, lengths and track, and the project its `look.md`.
 */
export type AnimationLook = {
  /** Who speaks: two characters taking turns (2D), one narrator, or the avatar (a host). */
  cast: 'duo' | 'host' | 'narrator'
  /** The library track the setup card picks with it (Motion Reel's library); null: Claude
   *  composes the music by default. */
  defaultTrackId: null | string
  description: string
  id: AnimationLookId
  label: string
  /** The lengths the card suggests, in seconds. */
  lengths: number[]
  /** What it looks like, for look.md. */
  look: string
  /** Background first, then text, then accents (hex). */
  palette: string[]
  skill: string
  /** A style's Avatar explainer version: the user's avatar hosts it in this style. */
  withAvatar?: {
    description: string
    /** The avatar styles it takes: one, or the user's pick. */
    avatarStyles: readonly ('2d' | '3d')[]
    /** How the host lives in this world, for look.md. */
    host: string
    /** The avatar kit draws this world itself (its sets): the style's own skill isn't needed. */
    ownWorld?: boolean
  }
}

export const ANIMATION_FPS = 30
/** 9:16 only for now. */
export const ANIMATION_SIZE = { height: 1920, width: 1080 } as const
export const ANIMATION_SUBJECT_MAX = 600
/** The lengths the card suggests (seconds); any whole number from ANIMATION_MIN_SEC to
 *  ANIMATION_MAX_SEC can be typed in. A Short stays within 90 s. */
export const ANIMATION_LENGTHS = [15, 30, 45, 60, 90] as const
export const ANIMATION_MIN_SEC = 10
export const ANIMATION_MAX_SEC = 90
export const ANIMATION_DEFAULT_SEC = 30

export const ANIMATION_LOOKS: readonly AnimationLook[] = [
  {
    cast: 'duo',
    defaultTrackId: 'data-pulse',
    description: 'Cartoon characters talk you through it, with voices and lip sync.',
    id: '2d',
    label: '2D',
    lengths: [...ANIMATION_LENGTHS],
    look: 'Flat, bright cartoon: two characters with faces (objects, food, animals, people, the Moon) in a simple setting, thick soft outlines, big eyes, a speech bubble for who is talking.',
    palette: ['#FFF4E0', '#2B2140', '#FF7A59', '#4CC9F0', '#FFD166'],
    skill: 'reelmakeeasy-animation-2d',
    withAvatar: {
      avatarStyles: ['2d'],
      description: 'Your avatar hosts it as a 2D cartoon, pointing at pictures as it talks.',
      host: 'The avatar drawn 2D, waist up, talking to the camera in a flat cartoon set.',
      ownWorld: true,
    },
  },
  {
    cast: 'narrator',
    defaultTrackId: 'dark-precision',
    description: 'A 3D scene shows how something works, with a narrator.',
    id: '3d',
    label: '3D',
    lengths: [...ANIMATION_LENGTHS],
    look: 'Clean 3D: one detailed hero object or machine under soft studio light, a dark ground with fog, labels with leader lines on the parts being explained, a camera that is always moving.',
    palette: ['#0E1116', '#F5F7FA', '#5EEAD4', '#F59E0B', '#A78BFA'],
    skill: 'reelmakeeasy-animation-3d',
    withAvatar: {
      avatarStyles: ['3d'],
      description: 'Your avatar hosts it as a 3D figure, in the 3D world it explains.',
      host: 'The avatar as a 3D figure in the 3D scene, under its studio light.',
      ownWorld: true,
    },
  },
  {
    cast: 'narrator',
    defaultTrackId: 'neon-drive',
    description: 'Pixel art, like an old video game, with a narrator.',
    id: '8bit',
    label: 'Pixel art',
    lengths: [...ANIMATION_LENGTHS],
    look: 'Pixel art like an old video game: a low-resolution 3D scene drawn blocky and dithered, x-ray cutaways, crisp pixel-font captions and labels, a busy screen with at least three things moving.',
    palette: ['#10101A', '#F8F8F8', '#FF004D', '#29ADFF', '#FFEC27', '#00E436'],
    skill: 'reelmakeeasy-animation-8bit',
    withAvatar: {
      avatarStyles: ['2d', '3d'],
      description: 'Your avatar hosts it in pixel art, inside the game world, drawn 2D or 3D.',
      host: 'The avatar drawn into the pixel world with the same pixel grid (`PixelTalkingHead`): a 3D avatar stands in the low-res scene, a 2D one is pixelated on top of it.',
    },
  },
  {
    cast: 'host',
    // Claude composes it: light and cute, made to talk over.
    defaultTrackId: null,
    description: 'Your own avatar talks to the camera, waist up, with gestures.',
    id: 'avatar',
    label: 'Avatar explainer',
    lengths: [...ANIMATION_LENGTHS],
    look: "The avatar (a 2D cartoon or a 3D figure drawn from the user's photo) waist up in a simple set, looking into the camera, lip-synced, gesturing on its key words, with pictures popping up beside or above it on the words they show.",
    palette: ['#1B1F2A', '#F5F7FA', '#FFD166', '#4CC9F0', '#FF7A59'],
    skill: 'reelmakeeasy-animation-avatar',
  },
]

/** Avatars are made in these styles. */
export const AVATAR_STYLES = ['2d', '3d'] as const
/** The longest avatar name. */
export const AVATAR_NAME_MAX = 40

export const ANIMATION_LOOK_IDS: readonly AnimationLookId[] = ANIMATION_LOOKS.map((l) => l.id)

/** The styles the card offers; with "Avatar explainer" ticked, the avatar hosts it in one. */
export const ANIMATION_STYLES = ANIMATION_LOOKS.filter(
  (l): l is AnimationLook & { id: AnimationStyleId } => l.id !== 'avatar',
)

export const isAnimationStyle = (id: unknown): id is AnimationStyleId =>
  ANIMATION_STYLES.some((s) => s.id === id)

export function animationLook(id: string): AnimationLook | undefined {
  return ANIMATION_LOOKS.find((look) => look.id === id)
}

/** The look card the agent reads (`animation/look.md`). An Avatar explainer names its style
 *  (`stage`): the world the host is drawn in, its palette and the style's skill too. */
export function renderLookCard(look: AnimationLook, stage?: AnimationLook): string {
  const world = look.id === 'avatar' && stage?.withAvatar ? stage : undefined
  // The 2D and 3D hosts bring their own sets; Pixel art is a world the host steps into.
  const own = world?.withAvatar?.ownWorld
  return [
    `# Look: ${look.label}${world ? `, in ${world.label}` : ''}`,
    '',
    `- **What it is:** ${world?.withAvatar?.description ?? look.description}`,
    `- **Look:** ${world && !own ? `${world.withAvatar?.host ?? ''} The world: ${world.look}` : look.look}`,
    `- **Palette:** ${(world && !own ? world : look).palette.join(', ')} (background, text, accents)`,
    `- **Voices:** ${look.cast === 'duo' ? 'two characters taking turns, each a designed voice' : look.cast === 'host' ? "the avatar's own voice (Host: avatar)" : 'one narrator'}`,
    world && !own
      ? `- **How to build it:** follow the \`${look.skill}\` skill for the host, and the \`${world.skill}\` skill for the world it stands in.`
      : `- **How to build it:** follow the \`${look.skill}\` skill.`,
    '',
  ].join('\n')
}
