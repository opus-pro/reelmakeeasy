import { PUBLIC_CDN_BASE_URL } from '../storage/public-assets'

import { TextureTemplateName } from './type'

const cdnPrefix = `${PUBLIC_CDN_BASE_URL}/ae-template/lottie`

export const getTexturePath = (textureTemplateName: TextureTemplateName, imageId: string) =>
  `${cdnPrefix}/${textureTemplateName}/images/${imageId}.png`

export const getBgPath = (texture: TextureTemplateName, bgTemplateName: string) =>
  `${cdnPrefix}/${texture}/backgrounds/${bgTemplateName}.mp4`
