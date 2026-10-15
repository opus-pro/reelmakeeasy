'use client'

import type { MusicRequest } from '@reelmakeeasy/common/long-take/music-craft'
import { cn, toast } from '@shared/ui'
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'

import { Spinner } from '@/components/agent/Spinner'
import { CheckMark, Delete, Pause, Play } from '@/components/icons/core'
import { useAudio } from '@/hooks/useAudio'

import { menuSections, type MusicMenuItem } from './music-menu'
import { MAX_MUSIC_TRACK_BYTES, useMusicCatalog } from './useMusicCatalog'

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac'

const rowClass =
  'flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-2 text-left text-primary transition-colors hover:bg-fill-hover disabled:cursor-not-allowed disabled:opacity-50'

/**
 * The music menu: make one for this video (a mood or the user's own words), a library
 * track, one of the user's tracks (with upload), or no music. Library and own tracks can
 * be previewed in place; a pick calls `onPick` with the request.
 */
export function MusicSourceMenu({
  current,
  disabled = false,
  onPick,
}: {
  current: MusicRequest
  disabled?: boolean
  onPick: (request: MusicRequest) => void
}) {
  const { library, loaded, mine, refresh, remove, upload } = useMusicCatalog()
  // Opening the menu reads the lists again: music generated since (saved to My music
  // automatically) or uploaded elsewhere shows up without a reload.
  useEffect(() => {
    void refresh()
  }, [refresh])
  const sections = useMemo(() => menuSections({ current, library, mine }), [current, library, mine])
  const audio = useAudio()
  const [describing, setDescribing] = useState(false)
  const [note, setNote] = useState(current.track ? '' : (current.note ?? ''))
  const [pending, setPending] = useState<null | { file: File; name: string }>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // A preview never outlives the menu.
  const { pause } = audio
  useEffect(() => () => pause(), [pause])

  const pick = (request: MusicRequest) => {
    audio.pause()
    onPick(request)
  }

  const onDescribe = (e: FormEvent) => {
    e.preventDefault()
    const wish = note.replace(/\s+/g, ' ').trim()
    if (wish) pick({ choice: 'auto', note: wish })
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_MUSIC_TRACK_BYTES) {
      toast.warning('Tracks can be up to 50 MB.')
      return
    }
    setPending({
      file,
      name: file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim(),
    })
  }

  const onUpload = async (e: FormEvent) => {
    e.preventDefault()
    if (!pending || uploading) return
    setUploading(true)
    try {
      const track = await upload(pending.file, pending.name.trim() || 'My track')
      setPending(null)
      toast.success(`"${track.name}" is in My music.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload the track.')
    } finally {
      setUploading(false)
    }
  }

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? Videos that already use it keep their music.`)) return
    if (audio.playingId === id) audio.pause()
    try {
      await remove(id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the track.')
    }
  }

  const renderItem = (item: MusicMenuItem, key: string) => {
    if (item.kind === 'choice') {
      return (
        <button
          className={rowClass}
          disabled={disabled}
          key={key}
          onClick={() => pick(item.request)}
          type="button"
        >
          <span className="flex flex-1 flex-col px-0.5">
            <span className="text-sm font-medium">{item.label}</span>
            <span className="text-xs text-secondary">{item.description}</span>
          </span>
          {item.selected && <CheckMark className="size-4.5 shrink-0 text-primary" />}
        </button>
      )
    }
    if (item.kind === 'describe') {
      if (!describing) {
        return (
          <button
            className={rowClass}
            disabled={disabled}
            key={key}
            onClick={() => setDescribing(true)}
            type="button"
          >
            <span className="flex flex-1 flex-col px-0.5">
              <span className="text-sm font-medium">Describe it…</span>
              <span className="truncate text-xs text-secondary">
                {item.note || 'In your own words, e.g. warm acoustic guitar'}
              </span>
            </span>
            {item.selected && <CheckMark className="size-4.5 shrink-0 text-primary" />}
          </button>
        )
      }
      return (
        <form className="flex items-center gap-1.5 px-2.5 py-1.5" key={key} onSubmit={onDescribe}>
          <input
            aria-label="Describe the music"
            autoFocus
            className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-background px-2 text-sm text-primary outline-none placeholder:text-secondary focus:border-white/30 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="warm acoustic guitar, slow"
            value={note}
          />
          <button
            className="h-8 shrink-0 rounded-md bg-white/10 px-2.5 text-sm text-primary hover:bg-white/15 disabled:opacity-40"
            disabled={disabled || !note.trim()}
            type="submit"
          >
            Use
          </button>
        </form>
      )
    }
    if (item.kind === 'upload') {
      if (!pending) {
        return (
          <div key={key}>
            <button
              className={rowClass}
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              <span className="flex flex-1 flex-col px-0.5">
                <span className="text-sm font-medium">Upload a track…</span>
                <span className="text-xs text-secondary">
                  Your brand music: mp3, wav or m4a, up to 10 minutes. Reuse it on any video.
                </span>
              </span>
            </button>
            <input
              accept={AUDIO_ACCEPT}
              className="hidden"
              onChange={onFile}
              ref={fileRef}
              type="file"
            />
          </div>
        )
      }
      return (
        <form className="flex flex-col gap-1.5 px-2.5 py-1.5" key={key} onSubmit={onUpload}>
          <input
            aria-label="Track name"
            autoFocus
            className="h-8 rounded-md border border-white/10 bg-background px-2 text-sm text-primary outline-none focus:border-white/30 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
            disabled={uploading}
            maxLength={80}
            onChange={(e) => setPending({ ...pending, name: e.target.value })}
            value={pending.name}
          />
          <div className="flex items-center justify-end gap-1.5">
            {uploading && <Spinner className="text-secondary" />}
            <button
              className="h-8 rounded-md px-2.5 text-sm text-secondary hover:text-primary disabled:opacity-40"
              disabled={uploading}
              onClick={() => setPending(null)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-8 rounded-md bg-white/10 px-2.5 text-sm text-primary hover:bg-white/15 disabled:opacity-40"
              disabled={uploading}
              type="submit"
            >
              {uploading ? 'Uploading…' : 'Save'}
            </button>
          </div>
        </form>
      )
    }
    const playing = audio.playingId === item.trackId
    return (
      <div className="flex items-center gap-1 rounded-sm hover:bg-fill-hover" key={key}>
        <button
          aria-label={playing ? `Stop ${item.label}` : `Play ${item.label}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-secondary hover:text-primary disabled:opacity-40"
          disabled={!item.previewUrl}
          onClick={() => item.previewUrl && audio.toggle(item.trackId, item.previewUrl)}
          type="button"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button
          className={cn(rowClass, 'min-w-0 flex-1 pl-0 hover:bg-transparent')}
          disabled={disabled}
          onClick={() => pick(item.request)}
          type="button"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{item.label}</span>
            <span className="truncate text-xs text-secondary">{item.description}</span>
          </span>
          {item.selected && <CheckMark className="size-4.5 shrink-0 text-primary" />}
        </button>
        {item.deletable && (
          <button
            aria-label={`Delete ${item.label}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-secondary hover:text-primary"
            onClick={() => void onDelete(item.trackId, item.label)}
            type="button"
          >
            <Delete className="size-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-h-[min(460px,70vh)] w-80 flex-col overflow-y-auto overflow-x-hidden">
      {sections.map((section) => (
        <div className="flex flex-col" key={section.id}>
          {section.title && (
            <span className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              {section.title}
            </span>
          )}
          {section.id === 'library' && !loaded ? (
            <span className="px-2.5 py-2 text-xs text-secondary">Loading…</span>
          ) : (
            section.items.map((item, i) => renderItem(item, `${section.id}-${i}`))
          )}
        </div>
      ))}
    </div>
  )
}
