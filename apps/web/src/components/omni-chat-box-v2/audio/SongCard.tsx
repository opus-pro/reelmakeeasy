'use client'
import { cn, Popover } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { type ContextMenuItem, ContextMenuItems } from '@/components/ContextMenu'
import { Delete, Music } from '@/components/icons/core'
import { AudioPlayer } from '@/util/audio-player'

import { STORY_CARD_SURFACE, type StoryCardSurface } from '../story-card-surface'

import { TILE_BUTTON } from './AudioCard'
import { AudioPlaybackIconButton } from './AudioPlaybackIconButton'

const FF_STYLE = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const

type SongCardProps = {
  /** File input `accept` for the song audio picker. */
  accept: string
  /** Playback URL of the uploaded song; powers the play/pause button + progress. */
  audioUrl?: null | string
  className?: string
  disabled?: boolean
  /** Uploaded song file name, shown as the card subtitle once a song is attached. */
  fileName?: null | string
  mobileLayout?: boolean
  /** Remove the uploaded song. Enables the "Delete" option once a song exists. */
  onRemove?: () => void
  onSelectFiles: (files: File[]) => void
  /** Subtitle shown before a song is uploaded; keeps the line reserved so the
   * card does not reflow when a file name appears. */
  placeholder?: string
  surface?: StoryCardSurface
}

/**
 * Song-to-video entry card. Mirrors the AudioCard chrome but opens the native
 * audio picker on tap instead of the voiceover dialog, and shows the uploaded
 * file name. Song-to-video uploads a track rather than picking a TTS voice.
 * Once a song is attached the music icon becomes a play/pause control for the
 * uploaded track, and tapping the card opens a Replace / Delete popover.
 * Mobile only; the desktop song flow uses SongUploadCard.
 */
export function SongCard({
  accept,
  audioUrl,
  className,
  disabled = false,
  fileName,
  mobileLayout = false,
  onRemove,
  onSelectFiles,
  placeholder = 'Upload a song',
  surface = 'solid',
}: SongCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [player, setPlayer] = useState<AudioPlayer>()
  const [progress, setProgress] = useState(0)
  const hasFile = Boolean(fileName)
  // With a song attached, tapping the card opens the Replace/Delete menu rather
  // than the picker directly; the play button (below) is exempt via stopPropagation.
  const showMenu = hasFile && !disabled

  // Playback mirrors AudioCard, but the URL is the uploaded track (no voice fetch).
  useEffect(() => {
    if (audioUrl) {
      const createdPlayer = new AudioPlayer(audioUrl, {
        onEnded: () => setIsPlaying(false),
        onPause: () => setIsPlaying(false),
        onPlay: () => setIsPlaying(true),
        onTimeUpdate: (currentTime, duration) => {
          setProgress(duration > 0 ? Math.max(0, Math.min(currentTime / duration, 1)) : 0)
        },
      })
      setPlayer(createdPlayer)
    } else {
      setPlayer(undefined)
    }
    setProgress(0)
    setIsPlaying(false)
  }, [audioUrl])

  useEffect(() => {
    if (!player) {
      return
    }
    return () => player.destroy()
  }, [player])

  useEffect(() => {
    if (!player) {
      return
    }
    if (disabled) {
      player.reset()
      return
    }
    if (isPlaying) {
      player.play()
      return
    }
    // Pause in place (not reset) so the song resumes from where the user paused
    // and the progress bar keeps its position; reset is reserved for disable.
    player.pause()
    return () => player.pause()
  }, [disabled, isPlaying, player])

  const openPicker = () => {
    if (!disabled) {
      inputRef.current?.click()
    }
  }

  const handlePlayPause = () => {
    if (!audioUrl) {
      return
    }
    setIsPlaying((prev) => !prev)
  }

  const progressWidth = `${Math.max(Math.min(1, Math.max(0, progress)), isPlaying ? 0.01 : 0) * 100}%`

  // Replace is intentionally left out for now: delete, then tap the card to upload
  // a new song. Delete clears the editor meta tag too, so no orphaned pill is left.
  const menuItems: ContextMenuItem[] = [
    {
      icon: <Delete className="size-4.5" />,
      label: 'Delete',
      onClick: onRemove,
    },
  ]

  // Stable sibling (never remounts when hasFile flips), so an in-flight picker
  // opened by Replace survives the re-render that removing the song triggers.
  const fileInput = (
    <input
      accept={accept}
      className="hidden"
      disabled={disabled}
      onChange={(e) => {
        const files = e.target.files ? Array.from(e.target.files) : []
        // Reset so re-selecting the same file still fires onChange.
        e.target.value = ''
        if (files.length === 0) {
          return
        }
        onSelectFiles(files)
      }}
      ref={inputRef}
      type="file"
    />
  )

  const card = (
    // As AudioCard: a tile-wide button and the play button side by side, never nested.
    <div
      aria-disabled={disabled || undefined}
      className={cn(
        'relative flex h-auto aspect-square md:aspect-[3/4] w-[60px] min-w-[60px] min-h-[60px] cursor-pointer flex-col items-start justify-between overflow-hidden rounded-xs p-1.5 text-left text-white shadow-none transition-colors',
        STORY_CARD_SURFACE[surface].rest,
        disabled ? 'cursor-default opacity-50' : STORY_CARD_SURFACE[surface].hover,
        className,
      )}
    >
      {hasFile && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-white/[0.15]"
          style={{ width: progressWidth }}
        />
      )}
      <button
        aria-label={hasFile ? 'Song options' : 'Upload a song'}
        className={TILE_BUTTON}
        disabled={disabled}
        // With a song, the click reaches the menu's trigger (this tile); without, it uploads.
        onClick={showMenu ? undefined : openPicker}
        type="button"
      />
      <span className="pointer-events-none relative z-[2] flex size-full min-w-px flex-col items-start justify-between">
        <span
          className={cn(
            'pointer-events-auto flex shrink-0 items-center justify-center',
            mobileLayout ? 'size-[var(--mobile-icon-size)]' : 'size-[18px]',
          )}
        >
          {hasFile ? (
            <AudioPlaybackIconButton
              disabled={disabled || !audioUrl}
              isPlaying={isPlaying}
              mobileLayout={mobileLayout}
              onClick={(event) => {
                event.stopPropagation()
                handlePlayPause()
              }}
              pauseAriaLabel="Pause uploaded song"
              playAriaLabel="Play uploaded song"
            />
          ) : (
            <Music className="size-full text-secondary" />
          )}
        </span>
        <span className="flex min-h-[27px] max-w-full flex-col items-start">
          <span
            className={cn(
              'max-w-full truncate font-medium text-white',
              mobileLayout ? 'text-base leading-[20px]' : 'text-xs leading-[15px]',
            )}
            style={FF_STYLE}
            title="Song"
          >
            Song
          </span>
          {/* Always rendered so the line is reserved: shows the supporting text
              ("Required") until a song is uploaded, then the file name. Same
              color as the sibling cards' supporting text. */}
          <span
            className={cn(
              'max-w-full truncate font-medium',
              mobileLayout
                ? 'text-sm leading-[17px] text-white/60'
                : 'text-[10px] leading-[12px] text-secondary',
            )}
            style={FF_STYLE}
            title={fileName ?? placeholder}
          >
            {fileName ?? placeholder}
          </span>
        </span>
      </span>
    </div>
  )

  return (
    <>
      {fileInput}
      {showMenu ? (
        <Popover
          align="end"
          className="z-[80] w-[180px] rounded-[16px] border-0 bg-menu/80 p-0 shadow-none backdrop-blur-2xl"
          collisionPadding={{ bottom: 16, left: 8, right: 8, top: 8 }}
          content={
            <ContextMenuItems
              itemClassName="h-[38px] rounded-sm px-2.5 text-sm font-medium leading-[17px] hover:bg-white/10"
              items={menuItems}
              onItemClick={() => setMenuOpen(false)}
            />
          }
          modal={mobileLayout}
          onOpenChange={setMenuOpen}
          open={menuOpen}
          side="bottom"
          sideOffset={6}
        >
          {card}
        </Popover>
      ) : (
        card
      )}
    </>
  )
}
