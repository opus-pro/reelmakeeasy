import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common'
import type { LibrarySound, LibrarySoundPatch } from '@shared/types/api/sound-library'

import { SoundInputError, SoundLibraryService, SoundNotFoundError } from './sound-library.service'

async function answer<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof SoundNotFoundError) throw new NotFoundException(error.message)
    if (error instanceof SoundInputError) throw new BadRequestException(error.message)
    throw error
  }
}

/** The user's sound library (`/api/sounds`): upload, list, rename, favourite, remove. */
@Controller('sounds')
export class SoundLibraryController {
  constructor(private readonly sounds: SoundLibraryService) {}

  @Get()
  list(): LibrarySound[] {
    return this.sounds.list()
  }

  /** Adds an uploaded file (`{ fileUri, name }` from a signed upload). */
  @Post()
  add(@Body() body: { fileUri?: unknown; name?: unknown }): Promise<LibrarySound> {
    return answer(() => this.sounds.add(body?.fileUri, body?.name))
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: LibrarySoundPatch): Promise<LibrarySound> {
    return answer(() =>
      this.sounds.update(id, {
        favorite: body?.favorite,
        name: body?.name,
        trimEndSec: body?.trimEndSec,
        trimStartSec: body?.trimStartSec,
        volume: body?.volume,
      }),
    )
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await answer(() => this.sounds.remove(id))
  }
}
