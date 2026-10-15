import {
  MUSIC_CHOICE_OPTIONS,
  MUSIC_MOODS,
  type MusicChoice,
  type MusicMood,
  type MusicRequest,
  sanitizeMusicChoice,
} from '@reelmakeeasy/common/long-take/music-craft'
import type { MusicLibraryTrackDto, UserMusicTrackDto } from '@shared/types/api/music'

export type MusicMenuItem =
  | {
      deletable: boolean
      description: string
      kind: 'track'
      label: string
      previewUrl: null | string
      request: MusicRequest
      selected: boolean
      trackId: string
    }
  | { description: string; kind: 'choice'; label: string; request: MusicRequest; selected: boolean }
  | { kind: 'describe'; note: string; selected: boolean }
  | { kind: 'upload' }

export interface MusicMenuSection {
  id: 'library' | 'make' | 'mine' | 'off'
  items: MusicMenuItem[]
  /** null for the closing "No music" row. */
  title: null | string
}

/** "1:05" for a track's length. */
export function formatTrackLength(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const moodRank = (mood: string) => {
  const i = MUSIC_MOODS.indexOf(mood as MusicMood)
  return i === -1 ? MUSIC_MOODS.length : i
}

/**
 * The music menu shared by the composer pill and the Change buttons: make one for this
 * video (a mood or the user's words), the library, the user's own tracks (with Upload),
 * or no music, with the current pick marked.
 */
export function menuSections(input: {
  current: MusicRequest
  library: MusicLibraryTrackDto[]
  mine: UserMusicTrackDto[]
}): MusicMenuSection[] {
  const { current, library, mine } = input
  const choice = sanitizeMusicChoice(current.choice)
  const track = choice === 'off' ? undefined : current.track
  const note = !track && choice !== 'off' ? (current.note ?? '') : ''
  const choiceItem = (c: MusicChoice): MusicMenuItem => ({
    description: MUSIC_CHOICE_OPTIONS[c].description,
    kind: 'choice',
    label: MUSIC_CHOICE_OPTIONS[c].label,
    request: { choice: c },
    selected: !track && !note && choice === c,
  })
  const sections: MusicMenuSection[] = [
    {
      id: 'make',
      items: [
        choiceItem('auto'),
        choiceItem('upbeat'),
        choiceItem('calm'),
        { kind: 'describe', note, selected: Boolean(note) },
      ],
      title: 'Make one for this video',
    },
  ]
  if (library.length > 0) {
    sections.push({
      id: 'library',
      items: [...library]
        .sort((a, b) => moodRank(a.mood) - moodRank(b.mood))
        .map((t) => ({
          deletable: false,
          description: [t.mood, t.description].filter(Boolean).join(' · '),
          kind: 'track' as const,
          label: t.title,
          previewUrl: t.variants[0]?.url ?? null,
          request: { choice: 'auto' as const, track: { id: t.id, source: 'library' as const } },
          selected: track?.source === 'library' && track.id === t.id,
          trackId: t.id,
        })),
      title: 'Library',
    })
  }
  sections.push(
    {
      id: 'mine',
      items: [
        ...mine.map((t) => ({
          deletable: true,
          description: t.aiGenerated
            ? `AI generated · ${formatTrackLength(t.durationSec)}`
            : formatTrackLength(t.durationSec),
          kind: 'track' as const,
          label: t.name,
          previewUrl: t.url,
          request: { choice: 'auto' as const, track: { id: t.id, source: 'upload' as const } },
          selected: track?.source === 'upload' && track.id === t.id,
          trackId: t.id,
        })),
        { kind: 'upload' as const },
      ],
      title: 'My music',
    },
    { id: 'off', items: [choiceItem('off')], title: null },
  )
  return sections
}
