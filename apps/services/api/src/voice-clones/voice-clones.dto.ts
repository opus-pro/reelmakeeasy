import { IsOptional, IsString } from 'class-validator'

// 'byteplus' is retained deliberately. The BytePlus clone path was removed, so nothing
// writes it any more, but rows with provider='byteplus' still exist and the read and delete
// paths must keep handling them. Removing it would make the type lie about the data.
// 'fal' is the same MiniMax model reached through fal.ai rather than a
// direct MiniMax contract. It is a distinct provider value, not a synonym, because
// clone ids are tenant-scoped -- a Fal row and its MiniMax original are different
// voices to the vendors even when they represent the same person.
export type VoiceCloneProvider = 'byteplus' | 'elevenlabs' | 'fal' | 'minimax' | 'qwen3'

export class CreateVoiceCloneDto {
  /**
   * How a `provider: 'fal'` clone was minted: 'sample' from the user's
   * own upload, 'preview' from a MiniMax-synthesized preview when the sample is
   * gone (the clone-of-clone fallback). Unset on MiniMax rows.
   */
  @IsOptional()
  @IsString()
  cloneSource?: 'preview' | 'sample'

  /**
   * On a `provider: 'fal'` row, the MiniMax `voiceId` this Fal clone was minted
   * from. The ONLY link between the two rows of a migrated voice, so it is what decides
   * whether a MiniMax original is hidden (already backfilled) or still shown (not yet).
   *
   * Writable here so the backfill can set it through the same `create` choke
   * point every other save path uses; the field existed in the schema and was read by
   * `getFalCounterpartVoiceId`, but nothing could write it, which would have left the
   * gate-on filter permanently inert.
   *
   * Never set on the interactive create path: a voice a user clones while the gate is on
   * is a NEW voice, not a migration of an existing one.
   */
  @IsOptional()
  @IsString()
  migratedFromVoiceId?: string

  @IsString()
  name!: string

  @IsOptional()
  @IsString()
  orgId?: string

  @IsOptional()
  @IsString()
  originalSource?: string

  @IsOptional()
  @IsString()
  provider?: VoiceCloneProvider

  /** Qwen3 only: the text spoken in the reference audio the voice was made from. */
  @IsOptional()
  @IsString()
  referenceText?: string

  /** Qwen3 only: storage path of the voice's speaker embedding. */
  @IsOptional()
  @IsString()
  speakerEmbeddingPath?: string

  @IsString()
  userId!: string

  @IsString()
  voiceId!: string
}
export class PlaybackUrlResponseDto {
  @IsString()
  expiresAt!: string

  @IsString()
  signedUrl!: string

  @IsString()
  voiceCloneId!: string
}
export class UpdateVoiceCloneDto {
  @IsOptional()
  @IsString()
  name?: string
}
