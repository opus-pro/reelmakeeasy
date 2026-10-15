import * as path from 'node:path/posix'

import { PATH_SEGMENTS, typedPathResolver } from '../../utils/path-resolver'
import { COMMON_DIRS } from '../paths'

export class ProjectPathResolver {
  /**
   * Get path for a specific retrieval asset data file
   */
  getRetrievalAssetDataPath(intentId: string, assetId: string): string {
    return path.join(this.getRetrievalAssetsPath(intentId), `${assetId}.json`)
  }

  /**
   * Get the relative path for retrieval intents assets folder (V2/storage)
   * Format: story_loader/retrieval_intents/{intentId}/assets
   */
  getRetrievalAssetsPath(intentId: string): string {
    return path.join(
      this.getStoryLoaderPath(),
      PATH_SEGMENTS.retrievalIntents,
      intentId,
      PATH_SEGMENTS.assets,
    )
  }

  /**
   * Get path for script text file
   */
  getScriptTextPath(): string {
    return path.join(this.getStoryLoaderPath(), PATH_SEGMENTS.scriptFile)
  }

  /**
   * Get path for stock video metadata file
   */
  getStockVideoDataPath(assetId: string): string {
    return path.join(this.getStoryLoaderAssetsPath(), 'stock_video_data', `${assetId}.json`)
  }

  /**
   * Get path for stock video preview image
   */
  getStockVideoImagePath(filename: string): string {
    return path.join(this.getStoryLoaderAssetsPath(), 'stock_video_images', filename)
  }

  /**
   * Get the relative path for story loader assets folder (V2/storage)
   */
  getStoryLoaderAssetsPath(): string {
    return path.join(this.getStoryLoaderPath(), PATH_SEGMENTS.assets)
  }

  /**
   * Get path for general story loader images (articles, youtube previews)
   */
  getStoryLoaderImagePath(filename: string): string {
    return path.join(this.getStoryLoaderImagesPath(), filename)
  }

  /**
   * Get path for story loader images folder
   */
  getStoryLoaderImagesPath(): string {
    return path.join(this.getStoryLoaderAssetsPath(), 'images')
  }

  /**
   * Get the relative path for the story_loader agent folder (V2/storage)
   */
  getStoryLoaderPath(): string {
    if (!typedPathResolver.hasAgent(PATH_SEGMENTS.storyLoader)) {
      throw new Error('Agent story_loader not found in config')
    }
    return PATH_SEGMENTS.storyLoader
  }

  /**
   * Get path for tweet metadata file
   */
  getTweetDataPath(tweetId: string): string {
    return path.join(this.getStoryLoaderAssetsPath(), 'tweets', `${tweetId}.json`)
  }

  /**
   * Get path for tweet image (avatar/media)
   */
  getTweetImagePath(filename: string): string {
    return path.join(this.getTweetImagesPath(), filename)
  }

  /**
   * Get path for tweet images folder
   */
  getTweetImagesPath(): string {
    return path.join(this.getStoryLoaderAssetsPath(), 'tweet_images')
  }

  getUserIntentDetectionPath(): string {
    return 'user-intent-detection.json'
  }

  /**
   * Get path for user uploaded files
   */
  getUserUploadedPath(fileName?: string): string {
    return fileName ? path.join(COMMON_DIRS.USER_UPLOADED, fileName) : COMMON_DIRS.USER_UPLOADED
  }

  /**
   * Get path for youtube video metadata file
   */
  getYoutubeDataPath(assetId: string): string {
    return path.join(this.getStoryLoaderAssetsPath(), 'youtube_data', `${assetId}.json`)
  }
}

export const projectPathResolver = new ProjectPathResolver()
