/**
 * Style config DTO returned by StyleConfigDataService (matches Prisma StyleConfig shape).
 */
export interface StyleConfigDto {
  createdAt: Date
  createdBy?: null | string
  defaultBackgroundImageUrl?: null | string
  defaultBackgroundThumbnailUrl?: null | string
  description: string
  displayName: string
  fonts: StyleFontDto[]
  id: string
  name: string
  overview: string
  palette: StylePaletteDto
  preferredGenres: string
  referenceImageUrl?: null | string
  status: string
  thumbnailUrl?: null | string
  updatedAt: Date
}

export interface StyleFontDto {
  family: string
  uri: string
  weight: string
}

export interface StylePaletteDto {
  primary: string
  secondary: string
}

/**
 * Service that provides StyleConfig database access.
 * Abstraction over Prisma for agent and worker code.
 */
export interface StyleConfigDataService {
  getAllLiveStyles(): Promise<StyleConfigDto[]>
  getStyleByName(name: string): Promise<null | StyleConfigDto>
  getStylesList(): Promise<StyleConfigDto[]>
}
