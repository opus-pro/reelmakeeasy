import { VideoAdapter } from '@reelmakeeasy/common/adapters/video-adapter'
import { VideoScriptAdapter } from '@reelmakeeasy/common/adapters/video-script-adapter'
import { CODEGEN_LAYOUT_ID, remotionType } from '@reelmakeeasy/common/template/consts'
import { RenderTemplate } from '@reelmakeeasy/common/template/type'
import { LottieSeg, SegType, TrackType } from '@reelmakeeasy/common/types/render-plan-struct'
import { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { useAsyncEffect } from 'ahooks'
import { useAtom, useAtomValue } from 'jotai'

import { useProjectId } from '@/contexts/ProjectContext'
import { useCdnOrigin } from '@/hooks/useCdnOrigin'
import { checkUrlExists } from '@/util/check-url-exists'

import { editorCoreStore } from '../stores/editor-core.store'

export const FPS = 25

export default function useRenderPlan(videoScript?: VideoScript) {
  const templateList = useAtomValue(editorCoreStore.templateList)
  const [renderPlan, setRenderPlan] = useAtom(editorCoreStore.renderPlan)
  const { projectId } = useProjectId()
  const cdnOrigin = useCdnOrigin()

  useAsyncEffect(async () => {
    if (!videoScript || !templateList || !projectId) {
      return
    }
    const newRenderPlan = await genRenderPlan(videoScript, templateList ?? [], projectId, cdnOrigin)
    setRenderPlan(newRenderPlan)
  }, [videoScript, templateList, projectId, cdnOrigin])

  return renderPlan
}

const getTemplatesCdnUrl = (
  cdnOrigin: string,
  layoutId: string,
  version = 1,
  name = 'template.json',
) => {
  if (layoutId === 'fullscreen') {
    // empty template for fullscreen
    return `${cdnOrigin}/atomic-templates/fullscreen/v1/template.json`
  }
  return `${cdnOrigin}/atomic-templates/${layoutId}/v${version}/${name}`
}

// Cache for preview format (webm or webp) - only check once, page refreshes on project switch
let previewFormat: 'webm' | 'webp' | null = null

// Check webm first (new format), fall back to webp (old format) for backward compatibility
export const getRemotionPreviewVideoUrl = async (
  projectId: string,
  segId: string,
  cdnOrigin: string,
) => {
  const baseUrl = `${cdnOrigin}/agent/workspace/${projectId}/remotion-preview/${segId}`

  // Use cached format if available
  if (previewFormat) {
    return `${baseUrl}.${previewFormat}`
  }

  // First check - determine format and cache it
  const webmExists = await checkUrlExists(`${baseUrl}.webm`)
  previewFormat = webmExists ? 'webm' : 'webp'

  return `${baseUrl}.${previewFormat}`
}

const genRenderPlan = async (
  videoScript: VideoScript,
  templateList: RenderTemplate[],
  projectId: string,
  cdnOrigin: string,
) => {
  const renderPlan = await VideoScriptAdapter.genRenderPlan({
    getFilePath: async (url: string) => storeUriToUrl(url),
    getTemplateAssetPath: async ({ layoutId }) => {
      if (layoutId === CODEGEN_LAYOUT_ID) {
        return CODEGEN_LAYOUT_ID
      }

      const template = templateList.find((t) => t.name === layoutId)

      return getTemplatesCdnUrl(cdnOrigin, layoutId, template?.version)
    },
    getAllTemplatesSpec: () => Promise.resolve(templateList),
    getFallbackFontPath: () => Promise.resolve(''),
    getMediaMetadata: () => Promise.resolve({ height: 1920, width: 1080 }),
    getVideoFps: () => FPS.toString(),
    outputSize: {
      height: 1280,
      width: 720,
    },
    rootDir: '',
    usePreview: true,
    videoScript,
  })

  if (!renderPlan) {
    throw new Error('Failed to generate render plan')
  }

  const remotionSegs = renderPlan.tracks
    .filter((track) => track.id.includes('template-asset'))
    .flatMap((track) => track.segs)
    .filter((seg): seg is LottieSeg => {
      if (seg.type !== SegType.Lottie) {
        return false
      }
      const lottieSeg = seg as LottieSeg
      return (
        lottieSeg.layoutId !== undefined &&
        (remotionType.includes(lottieSeg.layoutId) || lottieSeg.layoutId === CODEGEN_LAYOUT_ID)
      )
    })

  if (remotionSegs.length > 0) {
    const remotionVideoSegs = (
      await Promise.all(
        remotionSegs.map(async (seg) => {
          const previewUrl = await getRemotionPreviewVideoUrl(projectId, seg.id, cdnOrigin)
          return VideoAdapter.convertLottieSegToVideoSeg(seg, previewUrl)
        }),
      )
    ).toSorted((a, b) => a.in - b.in)
    const remotionSegIds = new Set(remotionSegs.map((seg) => seg.id))
    renderPlan.tracks.forEach((track) => {
      if (track.id.includes('template-asset')) {
        track.segs = track.segs.filter((seg) => !remotionSegIds.has(seg.id))
      }
    })

    const templateTrackIndex = renderPlan.tracks.findIndex((t) => t.id.includes('template-asset'))
    const insertIndex =
      templateTrackIndex === -1 ? renderPlan.tracks.length : templateTrackIndex + 1
    renderPlan.tracks.splice(insertIndex, 0, {
      id: '#RemotionPreviewTrack',
      type: TrackType.Video,
      segs: remotionVideoSegs,
    })
  }

  return renderPlan
}
