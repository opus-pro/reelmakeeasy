/** The music routes: the built-in library and the user's own tracks. */

/** A chosen track as the workflows take it: resolved by the API from a track ref. */
export interface MusicLibraryResponse {
  data: { tracks: MusicLibraryTrackDto[] }
}

export interface MusicLibraryTrackDto {
  description: string
  id: string
  mood: string
  title: string
  /** Ascending by length; `url` is where a browser plays the file from. */
  variants: { durationSec: number; url: string }[]
}

export interface MusicTrackArg {
  id: string
  source: 'library' | 'upload'
  /** Shown as the track name. */
  title: string
  /** The uploaded file's store:// uri; absent for library tracks. */
  uri?: string
}

export interface UserMusicTrackDto {
  /** Made by the music model for one of the user's videos (saved automatically). */
  aiGenerated: boolean
  createdAt: string
  durationSec: number
  id: string
  name: string
  url: string
}

export interface UserMusicTracksResponse {
  data: { tracks: UserMusicTrackDto[] }
}

/** After the browser uploaded the file to a temp signed URL (`media-temp`, scope `music-track`). */
export interface UserMusicTrackCreateRequest {
  name: string
  tempFileUri: string
}

export interface UserMusicTrackCreateResponse {
  data: UserMusicTrackDto
}
