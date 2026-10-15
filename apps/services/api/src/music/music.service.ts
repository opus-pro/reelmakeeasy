import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { logger } from '@reelmakeeasy/common/logger'
import {
  MUSIC_TRACK_NAME_MAX_LENGTH,
  type MusicCatalog,
  type MusicTrackRef,
} from '@reelmakeeasy/common/long-take/music-craft'
import { libraryTrackUrl, readMusicLibrary } from '@reelmakeeasy/common/long-take/music-library'
import { musicTrackUri } from '@reelmakeeasy/common/long-take/music-tracks'
import {
  deleteStoredFile,
  keyIsUnder,
  storeKeyOf,
  uploadToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  MusicLibraryTrackDto,
  MusicTrackArg,
  UserMusicTrackCreateRequest,
  UserMusicTrackDto,
} from '@shared/types/api/music'

import { PrismaService } from '../prisma/prisma.service'

import { type MusicUploadDeps, musicUploadDeps, prepareMusicUpload } from './music-upload'

type TrackRow = {
  cdnUrl: string
  createdAt: Date
  durationSec: number
  fileUri: string
  id: string
  name: string
  source?: null | string
}

const toDto = (row: TrackRow): UserMusicTrackDto => ({
  aiGenerated: row.source === 'generated',
  createdAt: row.createdAt.toISOString(),
  durationSec: row.durationSec,
  id: row.id,
  name: row.name,
  url: row.cdnUrl,
})

/** The built-in music library and a user's own tracks. */
@Injectable()
export class MusicService {
  constructor(private readonly prisma: PrismaService) {}

  /** The titles a text answer can name: the library and the user's tracks. */
  async catalog(userId: string): Promise<MusicCatalog> {
    const mine = await this.listTracks(userId)
    return {
      library: this.library().map((t) => ({
        description: t.description,
        id: t.id,
        mood: t.mood,
        title: t.title,
      })),
      mine: mine.map((t) => ({
        aiGenerated: t.aiGenerated,
        durationSec: t.durationSec,
        id: t.id,
        name: t.name,
      })),
    }
  }

  /**
   * Saves a track the browser uploaded to a temp signed URL: checks it, transcodes it to
   * the standard mp3 under the user's music-tracks folder, and records it.
   */
  async createTrack(
    userId: string,
    orgId: string | undefined,
    body: UserMusicTrackCreateRequest,
    deps: MusicUploadDeps = musicUploadDeps,
  ): Promise<UserMusicTrackDto> {
    const tempFileUri = String(body.tempFileUri ?? '').trim()
    const sanitizedUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9._-]/g, '_')
    const tempKey = storeKeyOf(tempFileUri)
    if (!tempKey || !keyIsUnder(tempKey, `tmp/${sanitizedUserId}`)) {
      throw new BadRequestException('Temp file must belong to the current user')
    }
    const name = trackName(body.name, tempFileUri)
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'music-track-'))
    try {
      const prepared = await prepareMusicUpload({ tempFileUri, workDir }, deps)
      const fileUri = musicTrackUri(userId, randomUUID())
      await uploadToStore(prepared.localMp3, fileUri)
      const row = await this.prisma.userMusicTrack.create({
        data: {
          // The address again: the served URL is built when the track is sent to a browser.
          cdnUrl: fileUri,
          durationSec: prepared.durationSec,
          fileUri,
          name,
          orgId: orgId || null,
          sizeBytes: prepared.sizeBytes,
          source: 'upload',
          userId,
        },
      })
      logger.info(
        `[music] track saved ${row.id} for ${userId} (${prepared.durationSec.toFixed(1)} s)`,
      )
      return toDto(row)
    } finally {
      // The temp upload is done with either way: saved as the track, or refused.
      await deleteStoredFile(tempFileUri).catch(() => undefined)
      await rm(workDir, { force: true, recursive: true })
    }
  }

  /** Removes the row and its file. Projects keep their own fitted copies, so nothing breaks. */
  async deleteTrack(userId: string, id: string): Promise<void> {
    const row = await this.prisma.userMusicTrack.findFirst({ where: { id, userId } })
    if (!row) throw new NotFoundException('Track not found')
    await this.prisma.userMusicTrack.delete({ where: { id } })
    await deleteStoredFile(row.fileUri).catch((error: unknown) => {
      logger.warn(`[music] track file not removed ${row.fileUri}: ${String(error)}`)
    })
  }

  /** The library manifest with playable urls. */
  library(): MusicLibraryTrackDto[] {
    return readMusicLibrary().tracks.map((t) => ({
      description: t.description,
      id: t.id,
      mood: t.mood,
      title: t.title,
      variants: t.variants.map((v) => ({ durationSec: v.durationSec, url: libraryTrackUrl(v) })),
    }))
  }

  async listTracks(userId: string): Promise<UserMusicTrackDto[]> {
    const rows = await this.prisma.userMusicTrack.findMany({
      orderBy: { createdAt: 'desc' },
      where: { userId },
    })
    return rows.map(toDto)
  }

  /** A track ref as the workflows take it; 404 when it is not the user's or not in the library. */
  async resolveTrackArg(userId: string, ref: MusicTrackRef): Promise<MusicTrackArg> {
    if (ref.source === 'library') {
      const track = readMusicLibrary().tracks.find((t) => t.id === ref.id)
      if (!track) throw new NotFoundException('Track not found')
      return { id: track.id, source: 'library', title: track.title }
    }
    const row = await this.prisma.userMusicTrack.findFirst({ where: { id: ref.id, userId } })
    if (!row) throw new NotFoundException('Track not found')
    return { id: row.id, source: 'upload', title: row.name, uri: row.fileUri }
  }
}

/** The track's name: the given one, else the file name without its extension. */
function trackName(given: unknown, tempFileUri: string): string {
  const typed = typeof given === 'string' ? given.replace(/\s+/g, ' ').trim() : ''
  const fromFile = path
    .basename(tempFileUri)
    .replace(/^\d+-/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  const name = (typed || fromFile || 'My track').slice(0, MUSIC_TRACK_NAME_MAX_LENGTH)
  return name
}
