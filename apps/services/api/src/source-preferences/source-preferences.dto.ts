import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator'

export enum YoutubeFilterType {
  ALL = 'all',
  BLOCK_ALL = 'blockAll',
  CREATIVE_COMMONS_ONLY = 'creativeCommonsOnly',
}

export class SourcePreferenceResponseDto {
  blockedSites!: string[]
  createdAt!: Date
  id!: string
  updatedAt!: Date
  userId!: string
  youtubeFilter!: YoutubeFilterType
}

export class UpdateSourcePreferenceDto {
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  blockedSites?: string[]

  @IsEnum(YoutubeFilterType)
  @IsOptional()
  youtubeFilter?: YoutubeFilterType
}
