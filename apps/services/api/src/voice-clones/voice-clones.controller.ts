import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common'

import { PlaybackUrlResponseDto, UpdateVoiceCloneDto } from './voice-clones.dto'
import { VoiceClonesService } from './voice-clones.service'

@Controller('voice-clones')
export class VoiceClonesController {
  constructor(private readonly voiceClonesService: VoiceClonesService) {}

  @Post('elevenlabs/temporary')
  async createTemporaryElevenLabsVoiceClone(@Body() body: { fileId: string }) {
    const reqCtx = getReqContext()

    return this.voiceClonesService.createTemporaryElevenLabsVoiceClone(
      body.fileId,
      reqCtx.login_id,
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      reqCtx.pii?.email || '',
    )
  }

  // Qwen3-TTS: clone the voice in an uploaded sample.
  @Post('qwen3/temporary')
  async createTemporaryQwen3VoiceClone(@Body() body: { fileId: string; referenceText?: string }) {
    if (!body.fileId) throw new BadRequestException('fileId is required')
    return this.voiceClonesService.createTemporaryQwen3VoiceClone(
      body.fileId,
      getReqContext().login_id,
      body.referenceText,
    )
  }

  @Post('minimax/temporary')
  async createTemporaryVoiceClone(@Body() body: { fileId: string }) {
    return this.voiceClonesService.createTemporaryMiniMaxVoiceClone(
      body.fileId,
      getReqContext().login_id,
    )
  }

  @Delete(':id')
  async deleteVoiceClone(@Param('id') id: string) {
    const voiceClone = await this.voiceClonesService.findById(id)
    if (!voiceClone) {
      throw new BadRequestException('Voice clone not found or access denied')
    }

    return this.voiceClonesService.delete(id)
  }

  // Qwen3-TTS: design a new voice from a written description.
  @Post('qwen3/design')
  async designTemporaryQwen3Voice(@Body() body: { description: string; sampleText?: string }) {
    return this.voiceClonesService.designTemporaryQwen3Voice(getReqContext().login_id, body)
  }

  @Get(':id/playback')
  async getPlaybackUrl(@Param('id') id: string): Promise<PlaybackUrlResponseDto> {
    return this.voiceClonesService.generatePlaybackUrl(id)
  }

  // Get playback URL for temporary ElevenLabs voice clone
  @Get('elevenlabs/temporary/:id/playback')
  async getTemporaryElevenLabsPlaybackUrl(
    @Param('id') id: string,
  ): Promise<{ expiresAt: string; signedUrl: string }> {
    return this.voiceClonesService.generateTemporaryPlaybackUrl(id)
  }

  // Get playback URL for temporary MiniMax voice clone
  @Get('minimax/temporary/:id/playback')
  async getTemporaryPlaybackUrl(
    @Param('id') id: string,
  ): Promise<{ expiresAt: string; signedUrl: string }> {
    return this.getTemporaryElevenLabsPlaybackUrl(id)
  }

  @Get('qwen3/temporary/:id/playback')
  async getTemporaryQwen3PlaybackUrl(
    @Param('id') id: string,
  ): Promise<{ expiresAt: string; signedUrl: string }> {
    return this.voiceClonesService.generateTemporaryPlaybackUrl(id)
  }

  // General voice clone management endpoints
  @Get('user')
  async getUserVoiceClones() {
    return this.voiceClonesService.findByUserIdAndProvider(getReqContext().org_id)
  }

  @Get(':id')
  async getVoiceClone(@Param('id') id: string) {
    const voiceClone = await this.voiceClonesService.findById(id)
    if (!voiceClone) {
      throw new BadRequestException('Voice clone not found or access denied')
    }

    return voiceClone
  }

  // Save temporary ElevenLabs voice clone to permanent
  @Post('elevenlabs/temporary/:id/save')
  async saveTemporaryElevenLabsVoiceClone(
    @Param('id') id: string,
    @Body() body: { fileId?: string; name: string },
  ) {
    const reqCtx = getReqContext()

    return this.voiceClonesService.saveTemporaryElevenLabsVoiceClone(
      id,
      body.name,
      reqCtx.login_id,
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      reqCtx.pii?.email || '',
      body.fileId,
    )
  }

  @Post('qwen3/temporary/:id/save')
  async saveTemporaryQwen3Voice(
    @Param('id') id: string,
    @Body() body: { fileId?: string; name: string },
  ) {
    if (!body.name?.trim()) throw new BadRequestException('name is required')
    return this.voiceClonesService.saveTemporaryQwen3Voice(
      id,
      body.name.trim(),
      getReqContext().login_id,
      body.fileId,
    )
  }

  // Save temporary MiniMax voice clone to permanent
  @Post('minimax/temporary/:id/save')
  async saveTemporaryVoiceClone(
    @Param('id') id: string,
    @Body() body: { fileId?: string; name: string },
  ) {
    const reqCtx = getReqContext()
    return this.voiceClonesService.saveTemporaryMiniMaxVoiceClone(
      id,
      body.name,
      reqCtx.login_id,
      body.fileId,
    )
  }

  @Put(':id')
  async updateVoiceClone(
    @Param('id') id: string,
    @Body() updateVoiceCloneDto: UpdateVoiceCloneDto,
  ) {
    const voiceClone = await this.voiceClonesService.findById(id)
    if (!voiceClone) {
      throw new BadRequestException('Voice clone not found or access denied')
    }

    return this.voiceClonesService.update(id, updateVoiceCloneDto)
  }

  // Upload audio file for ElevenLabs
  @Post('elevenlabs/upload')
  async uploadElevenLabsSample(
    @Body()
    body: {
      file: string
      fileName: string
    },
  ) {
    return this.uploadSample(body)
  }

  // Upload audio file for MiniMax
  @Post('minimax/upload')
  async uploadSample(
    @Body()
    body: {
      file: string
      fileName: string
    },
  ) {
    if (!body.file) {
      throw new BadRequestException('No file data provided')
    }

    const fileBuffer = Buffer.from(body.file, 'base64')
    return this.voiceClonesService.uploadFile(fileBuffer, getReqContext().login_id, body.fileName)
  }

  @Post('validate-audio')
  async validateAudio(
    @Body()
    body: {
      file: string
      fileName: string
    },
  ) {
    if (!body.file) {
      throw new BadRequestException('No file data provided')
    }

    const fileBuffer = Buffer.from(body.file, 'base64')

    try {
      return await this.voiceClonesService.validateAudioFile(fileBuffer, body.fileName)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to validate audio file'
      throw new BadRequestException(errorMessage)
    }
  }
}
