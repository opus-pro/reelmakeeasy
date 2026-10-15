import { Area, TemplateAssetContent } from '@reelmakeeasy/common/types/video-script'

import { ContentDel } from '../common'

import { type TemplateSegmentDel } from './segment'

export class TemplateContentDel extends ContentDel {
  layoutId: TemplateAssetContent['layoutId']
  override parent: TemplateSegmentDel
  targetAreas: TemplateAssetContent['targetAreas']
  get params() {
    return this._params
  }

  private _params: TemplateAssetContent['params']

  constructor(content: TemplateAssetContent, parent: TemplateSegmentDel) {
    super(content, parent)
    this.parent = parent
    this.layoutId = content.layoutId
    this._params = content.params
    this.targetAreas = content.targetAreas
  }

  /**
   * Convert remotion segment to fullscreen layout
   * This changes the layoutId to 'fullscreen' and updates params to fullscreen format
   * @param params.uri - The media URI (video or image) to use as background
   * @param params.previewUri - Optional preview URI for better performance
   * @param params.cropAreas - Optional crop areas to apply to the background
   */
  convertToFullscreen({
    uri,
    previewUri,
    cropAreas,
  }: {
    cropAreas?: Area[]
    previewUri?: string
    uri: string
  }): void {
    this.layoutId = 'fullscreen'
    this._params = {
      background: {
        id: 'bg_1',
        desc: 'Full-screen background',
        uri,
        previewSourceUri: previewUri ?? uri,
        cropAreas,
      },
    }
    // Clear targetAreas as fullscreen doesn't need them
    this.targetAreas = undefined
  }

  override parse(): TemplateAssetContent {
    return {
      id: this.id as TemplateAssetContent['id'],
      layoutId: this.layoutId,
      params: this._params,
      targetAreas: this.targetAreas,
    }
  }

  update(content: TemplateAssetContent): void {
    this.layoutId = content.layoutId
    this._params = content.params
    this.targetAreas = content.targetAreas
  }

  /**
   * Update cropAreas for all images in params
   * @param cropAreas - Array of Area objects defining crop regions
   * @returns true if update was successful, false if no images exist
   */
  updateImagesCropAreas(cropAreas: Area[]): boolean {
    if ((!this._params?.images?.length && !this._params?.background) || !cropAreas.length) {
      return false
    }

    const nextParams = { ...this._params }
    const hasMultipleImages = (this._params?.images?.length ?? 0) > 1
    const isAvatarFullscreen = this.layoutId === 'avatar_fullscreen'

    if (this._params?.background) {
      nextParams.background = {
        ...this._params.background,
        cropAreas,
      }
    }

    if (this._params?.images) {
      nextParams.images = this._params.images.map((img) => ({
        ...img,
        cropAreas:
          !isAvatarFullscreen &&
          hasMultipleImages &&
          typeof img.id === 'string' &&
          img.id.startsWith('avatar_')
            ? img.cropAreas
            : cropAreas,
      }))
    }

    this._params = nextParams
    return true
  }
}
