import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUrl } from 'class-validator'

export class CreateUserSavedStyleDto {
  @IsOptional()
  @IsString()
  imageDataUrl?: string

  @IsString()
  name!: string

  // Snapshots accumulated client-side before save, flushed here as the
  // style's initial history. Omitted by legacy SCC saves.
  @IsArray()
  @IsOptional()
  snapshots?: SnapshotInputDto[]

  @IsIn(['image', 'text'])
  styleInputMode!: 'image' | 'text'

  // Structured extras from the custom-style generator ({ summary, analysis,
  // colorPalette }). Optional -- v1 (SCC) styles omit it. Persisted verbatim as
  // the nullable `styleMetadata` Json column.
  @IsObject()
  @IsOptional()
  styleMetadata?: Record<string, unknown>

  @IsString()
  styleText!: string

  // Documentation only: the API does not install a global ValidationPipe, so
  // class-validator decorators on this DTO are not enforced at runtime. The
  // service-side `assertAllowedThumbnailUrl` is the load-bearing check.
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  thumbnailUrl?: string
}

// One rendered scene preview. The BE promotes the ephemeral blob behind
// `imageUrl` to a durable per-style path; `archetypeId` matches a
// SCENE_SAMPLE_IDS entry (scene_0/1/2).
export class ScenePreviewInputDto {
  @IsString()
  archetypeId!: string

  @IsString()
  imageUrl!: string
}

// The project a saved style was just applied to.
export class RecordStyleUseDto {
  @IsString()
  projectId!: string
}

// One generate/refine step the FE wants persisted as a snapshot. Scene previews
// are passed as their ephemeral CDN URLs; the service promotes + reorders them.
export class SnapshotInputDto {
  @IsObject()
  @IsOptional()
  analysis?: Record<string, unknown>

  @IsObject()
  @IsOptional()
  colorPalette?: Record<string, unknown>

  @IsString()
  reusableStylePrompt!: string

  @IsArray()
  scenePreviews!: ScenePreviewInputDto[]

  @IsOptional()
  @IsString()
  summary?: string

  // The chat message that produced this refine; absent for the initial generate.
  @IsOptional()
  @IsString()
  userRequest?: string
}

export class UpdateUserSavedStyleDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  styleText?: string
}
