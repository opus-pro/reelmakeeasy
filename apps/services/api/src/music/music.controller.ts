import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import type {
  MusicLibraryResponse,
  UserMusicTrackCreateRequest,
  UserMusicTrackCreateResponse,
  UserMusicTracksResponse,
} from '@shared/types/api/music'

import { MusicService } from './music.service'

/** The requesting user, as the other upload routes identify them. */
function userOf(): { orgId: string | undefined; userId: string } {
  const ctx = getReqContext()
  return { orgId: ctx.org_id || undefined, userId: ctx.user_id || ctx.login_id || 'anonymous' }
}

/** The built-in music library and the user's own tracks. */
@Controller('music')
export class MusicController {
  constructor(private readonly music: MusicService) {}

  // After the browser put the file on a temp signed URL (`generate-temp-upload-url`,
  // scope `music-track`): checks, transcodes and records it as the user's track.
  @Post('tracks')
  async createTrack(
    @Body() body: UserMusicTrackCreateRequest,
  ): Promise<UserMusicTrackCreateResponse> {
    if (!body?.tempFileUri?.trim()) {
      throw new BadRequestException('tempFileUri is required')
    }
    const { orgId, userId } = userOf()
    return { data: await this.music.createTrack(userId, orgId, body) }
  }

  @Delete('tracks/:id')
  async deleteTrack(@Param('id') id: string): Promise<{ data: { deleted: true } }> {
    await this.music.deleteTrack(userOf().userId, id)
    return { data: { deleted: true } }
  }

  @Get('library')
  library(): MusicLibraryResponse {
    return { data: { tracks: this.music.library() } }
  }

  @Get('tracks')
  async listTracks(): Promise<UserMusicTracksResponse> {
    return { data: { tracks: await this.music.listTracks(userOf().userId) } }
  }
}
