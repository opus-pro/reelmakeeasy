import { Logger } from '@reelmakeeasy/common/logger'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'

type StoredStyleImages = {
  defaultBackgroundImageUrl?: null | string
  defaultBackgroundThumbnailUrl?: null | string
  referenceImageUrl?: null | string
  thumbnailUrl?: null | string
}

@Injectable()
export class StyleService {
  private readonly logger = new Logger(StyleService.name)

  constructor(private readonly prisma: PrismaService) {}

  async getAllLiveStyles(): Promise<unknown[]> {
    try {
      this.logger.log('Fetching all Live styles')

      const styles = await this.prisma.styleConfig.findMany({
        where: { status: 'Live' },
        orderBy: {
          updatedAt: 'desc',
        },
      })

      this.logger.log(`Found ${styles.length} Live styles`)

      return styles.map((style) => this.addCdnUrlsToStyle(style))
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error }, 'Error fetching Live styles')
      throw error
    }
  }

  async getStyleByName(name: string): Promise<unknown> {
    try {
      this.logger.log(`Fetching style by name: ${name}`)

      const style = await this.prisma.styleConfig.findUnique({
        where: { name },
      })

      if (!style) {
        throw new Error(`Style with name "${name}" not found`)
      }

      return this.addCdnUrlsToStyle(style)
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error, name }, 'Error fetching style by name')
      throw error
    }
  }

  async getStylesList(): Promise<{
    message: string
    styles: unknown[]
    success: boolean
  }> {
    try {
      const styles = await this.prisma.styleConfig.findMany({
        orderBy: {
          updatedAt: 'desc',
        },
      })

      this.logger.log(`Found ${styles.length} styles`)

      return {
        success: true,
        message: `Successfully fetched ${styles.length} styles`,
        styles: styles.map((style) => this.addCdnUrlsToStyle(style)),
      }
    } catch (e) {
      const error = ensureError(e)
      this.logger.error({ error }, 'Error fetching styles')
      throw error
    }
  }

  private addCdnUrlsToStyle<T extends StoredStyleImages>(style: T) {
    return {
      ...style,
      referenceImageUrl: style.referenceImageUrl
        ? storeUriToUrl(style.referenceImageUrl)
        : undefined,
      thumbnailUrl: style.thumbnailUrl ? storeUriToUrl(style.thumbnailUrl) : undefined,
      defaultBackgroundImageUrl: style.defaultBackgroundImageUrl
        ? storeUriToUrl(style.defaultBackgroundImageUrl)
        : undefined,
      defaultBackgroundThumbnailUrl: style.defaultBackgroundThumbnailUrl
        ? storeUriToUrl(style.defaultBackgroundThumbnailUrl)
        : undefined,
    }
  }
}
