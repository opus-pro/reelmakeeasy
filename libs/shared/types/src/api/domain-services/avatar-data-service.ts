export interface SharedAvatarDto {
  /** db field */
  cropOffset: null | number
  /** of type Prisma.JSON */
  images: unknown[]
}

/**
 * Service that provides StyleConfig database access.
 * Abstraction over Prisma for agent and worker code.
 */
export interface AvatarDataService {
  getAiAvatarById(id: string): Promise<null | SharedAvatarDto>
  getStockAvatarById(id: string): Promise<null | SharedAvatarDto>
}
