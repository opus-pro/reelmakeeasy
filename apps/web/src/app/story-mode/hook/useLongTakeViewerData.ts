import { LOCAL_USER_ID } from '@reelmakeeasy/common/auth/local-identity'
import type {
  LongTakeLipSyncVideoVariants,
  LongTakeStatusStage,
  LongTakeStatusState,
} from '@shared/types/api/long-take'
import type { AspectRatio, Project, ProjectVoiceOverJson } from '@shared/types/api/project'
import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import { toast } from '@shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useLongTakeArtifacts } from '@/app/long-take/hooks/useLongTakeArtifacts'
import {
  type LoopPreviewMedia,
  loopPreviewMedia,
} from '@/app/story-mode/components/editor/render/loopPreview'
import { musicBusyProjectsAtom } from '@/app/story-mode/hook/useMusicToggle'
import {
  captionPreferencesAtom,
  renderSettingsAtom,
  seedRenderSettingsProjectAtom,
} from '@/atom/longtake-history.store'
import { projectIdAtom } from '@/atom/project'
import { matchStylePreset } from '@/components/omni-chat-box-v2/style/story-mode-style-helpers'
import { useApi } from '@/hooks/useApi'
import { useProjectAtom } from '@/hooks/useProjects'
import { useStoryModeStyleOptions } from '@/hooks/useStoryModeConfig'
import { useStoryModeTemplate } from '@/hooks/useStoryModeTemplates'
import { VideoMetaLoader } from '@/util/video-metadata'

import { getStageSecondaryText, isFailedStage } from '../components/LongTakeViewer/progress'

import { nextCaptionRenderSettings } from './captionRenderBaseline'
import { pickTemplateAudioUrl } from './templateAudio'

export const ASPECT_RATIO_CSS: Record<AspectRatio, string> = {
  '1:1': '1 / 1',
  '16:9': '16 / 9',
  '9:16': '9 / 16',
}

export type ViewerData = {
  assets?: QuickStartTemplateAsset[]
  audioPreviewUrl?: null | string
  audioUrl?: string
  // BGM bed surfaced from status polling for the editor live overlay.
  // Consumers gate rendering on the enable_bgm flag.
  bgmBedCdnUrl?: null | string
  bgmBedGainDb?: null | number
  // Persisted music on/off choice; seeds the panel toggle.
  bgmEnabled?: boolean | null
  // Raw Lyria model id + regenerated flag, polled so they stay fresh across
  // in-session regenerates; feed the project.downloaded BGM props.
  bgmModel?: null | string
  bgmRegenerated?: boolean | null
  bgmSource?: null | string
  bgmTrackId?: null | string
  bgmTrackName?: null | string
  bgmVolume?: null | number
  concurrentStages?: LongTakeStatusStage[]
  initPrompt?: string
  isAccessDenied: boolean
  isLoading: boolean
  isOwner: boolean
  lipSyncVideoVariants?: LongTakeLipSyncVideoVariants
  // A loop short's clip sound bed and joined clips, for the live preview (as the chat plays it).
  loopPreview: LoopPreviewMedia | null
  previewAspectRatio: string
  previewProject: Project
  ratio?: AspectRatio
  refetchProjectInfo: () => void
  resultVideoThumbnail?: string
  script?: string
  sourceVoice?: null | ProjectVoiceOverJson
  stage?: LongTakeStatusStage
  stageDetail?: string
  stageStatus?: LongTakeStatusState
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
  templateAudioUrl?: string
  uploadedAudioUrl?: null | string
  videoUrl: string
  watermarkVideoUrl?: null | string
}

export function useLongTakeViewerData(projectId: string): ViewerData {
  const setProjectId = useSetAtom(projectIdAtom)
  const setRenderSettings = useSetAtom(renderSettingsAtom)
  const seedRenderSettingsProject = useSetAtom(seedRenderSettingsProjectAtom)
  const { fetchApiDomain } = useApi()
  useEffect(() => {
    if (projectId) {
      setProjectId(projectId)
    }
    return () => setProjectId('')
  }, [projectId, setProjectId])

  const {
    projectInfo,
    error: projectError,
    isDeleted,
    isLoading: isProjectLoading,
    refetchProjectInfo,
  } = useProjectAtom()
  // While the Background music switch rewrites the delivered file, keep polling past
  // delivery so the toggle, the bed and the live preview read the result back.
  const musicBusy = useAtomValue(musicBusyProjectsAtom)[projectId] ?? false
  const artifacts = useLongTakeArtifacts(projectId, musicBusy)
  const storyModeTemplate = useStoryModeTemplate(projectId)
  const isProjectOwner = projectInfo?.owner === LOCAL_USER_ID
  const [detectedRatio, setDetectedRatio] = useState<AspectRatio | undefined>(undefined)

  useEffect(() => {
    setDetectedRatio(undefined)
  }, [projectId])

  // Sync caption baseline from polling. `original` follows the project state;
  // `latest` prefers the per-device persisted preference so a toggle survives
  // refresh on this device. Only update `original` when polled actually changes
  // -- polling stops at terminal stage, so a re-render commits a fresh original
  // that the polled value (frozen at pre-render) would otherwise overwrite.
  const polledEnableCaption = artifacts.status?.enableCaption
  const captionPreferences = useAtomValue(captionPreferencesAtom)
  const lastPolledRef = useRef<boolean | null | undefined>(undefined)
  const lastProjectIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    // Before the poll guard: the first status of a freshly opened project can
    // arrive without enableCaption, and the previous project's baseline must
    // not survive that gap.
    seedRenderSettingsProject(projectId)
    if (polledEnableCaption === undefined) {
      return
    }
    if (lastProjectIdRef.current !== projectId) {
      lastProjectIdRef.current = projectId
      lastPolledRef.current = undefined
    }
    const polledChanged = lastPolledRef.current !== polledEnableCaption
    lastPolledRef.current = polledEnableCaption
    const persistedPref = projectId ? captionPreferences[projectId] : undefined
    setRenderSettings((prev) =>
      nextCaptionRenderSettings({ persistedPref, polledChanged, polledEnableCaption, prev }),
    )
  }, [
    polledEnableCaption,
    projectId,
    captionPreferences,
    seedRenderSettingsProject,
    setRenderSettings,
  ])

  const isOwner = useMemo(() => {
    if (projectError) {
      return false
    }
    if (projectInfo) {
      return isProjectOwner
    }
    return false
  }, [projectInfo, projectError, isProjectOwner])

  const s = orEmpty(artifacts.status)
  const proj = orEmpty(projectInfo)
  const tmpl = orEmpty(storyModeTemplate)
  const { loopClipsUrl, loopSfxBedUrl, loopSfxBedVolume } = s
  const loopPreview = useMemo(
    () => loopPreviewMedia({ loopClipsUrl, loopSfxBedUrl, loopSfxBedVolume }),
    [loopClipsUrl, loopSfxBedUrl, loopSfxBedVolume],
  )

  const fallbackStyleThumbnailUrl = useMemo(
    () =>
      firstOf(
        storyModeTemplate?.assets.find((a) => a.mimeType.startsWith('image/'))?.url,
        storyModeTemplate?.thumbnail,
      ),
    [storyModeTemplate],
  )

  const videoUrl = firstOf(artifacts.videoUrl, proj.resultVideo, tmpl.resultVideo) ?? ''

  // Style fields: project DB is the authoritative source for the chosen style.
  // Artifacts polling (stored status) can return different style metadata for some
  // projects, causing the UI to flash from the correct style to a wrong one.
  // Prefer project data to prevent this override.
  const styleText = firstOf(proj.styleText, s.styleText, artifacts.styleText, tmpl.styleText)
  const styleOptions = useStoryModeStyleOptions()
  const rawStyleName = firstOf(
    proj.styleName,
    s.styleName,
    artifacts.styleName,
    tmpl.styleName,
    tmpl.styleText,
    tmpl.title,
  )
  const rawStyleThumbnailUrl = firstOf(
    proj.styleThumbnailUrl,
    s.styleThumbnailUrl,
    artifacts.styleThumbnailUrl,
    tmpl.styleThumbnailUrl,
    fallbackStyleThumbnailUrl,
  )

  // Script: for completed projects (have a video URL), prefer the project's
  // stored script. It is the final version and prevents stale status data
  // from hiding the user prompt (prompt is suppressed when it matches the
  // script after normalization). During generation, prefer artifacts data
  // which tracks in-progress refinements. While backend stage is still
  // "started", artifacts script can be the raw user prompt, so skip it.
  const isFinished = Boolean(proj.resultVideo)
  const rawScript = isFinished
    ? firstOf(proj.script, s.script, artifacts.script, tmpl.transcript)
    : artifacts.status?.stage !== undefined && artifacts.status.stage !== 'started'
      ? firstOf(s.script, artifacts.script, proj.script, tmpl.transcript)
      : firstOf(proj.script, tmpl.transcript)
  // Strip @img[...](...)  tags that may leak from user prompts into stored script values.
  const script = rawScript?.replace(/@img\[[^\]]*\]\([^)]*\)/g, '').trim() || rawScript
  // Always try to match the styleText against known style presets.
  // The preset provides the canonical name + thumbnail for a given style.
  // Raw sources (artifacts/stored status) can have mismatched thumbnails (e.g. a
  // "2D Line" style pointing to a "3D Animation" thumbnail).
  const presetMatch = useMemo(() => {
    if (!styleText) {
      return undefined
    }
    const match = matchStylePreset(styleText, styleOptions)
    return match.styleName === 'Custom style' ? undefined : match
  }, [styleText, styleOptions])
  const styleName = rawStyleName ?? presetMatch?.styleName
  // Prefer: DB thumbnail, then preset canonical thumbnail, then raw sources.
  // The preset thumbnail is the authoritative mapping for a given style;
  // raw sources (artifacts/stored status) may store stale or mismatched URLs.
  const styleThumbnailUrl =
    proj.styleThumbnailUrl ?? presetMatch?.thumbnailUrl ?? rawStyleThumbnailUrl

  const stage: LongTakeStatusStage | undefined =
    proj.stage === PROJECT_STAGE.FAILED ? 'error' : s.stage
  const stageDetail = artifacts.status?.detail
  const stageStatus = s.status
  const concurrentStages = s.concurrentStages

  const failureToastShownForProjectIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!isFailedStage(stage)) {
      return
    }
    if (failureToastShownForProjectIdRef.current === projectId) {
      return
    }
    failureToastShownForProjectIdRef.current = projectId
    toast.error(getStageSecondaryText(stage, stageDetail))
  }, [stage, stageDetail, projectId])

  // Backend falls back to a different provider when the picked voice's
  // provider is gated off for this user, without failing the render.
  const voiceSubstituted = s.meta?.voiceSubstituted === true
  const voiceSubstitutedToastShownForProjectIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!voiceSubstituted) {
      return
    }
    if (voiceSubstitutedToastShownForProjectIdRef.current === projectId) {
      return
    }
    voiceSubstitutedToastShownForProjectIdRef.current = projectId
    toast.warning("Your selected voice wasn't available, so we used an alternative.")
  }, [voiceSubstituted, projectId])

  useEffect(() => {
    if (!videoUrl || projectInfo?.longTakeRatio) {
      return
    }
    let isStale = false
    const loader = new VideoMetaLoader(videoUrl)
    loader.onLoadedMetadata = (video) => {
      if (isStale) {
        return
      }
      const ratioLabel = detectClosestAspectRatioLabel(video.videoWidth, video.videoHeight)
      if (ratioLabel) {
        setDetectedRatio(ratioLabel)
      }
    }
    return () => {
      isStale = true
      loader.dispose()
    }
  }, [projectId, projectInfo?.longTakeRatio, videoUrl])

  const ratio = firstOf(proj.longTakeRatio, detectedRatio, tmpl.aspectRatio)
  const previewAspectRatio = ASPECT_RATIO_CSS[ratio ?? '9:16']

  const previewProject = useMemo(() => {
    const watermarkVideoUrl = firstOf(artifacts.watermarkVideoUrl, projectInfo?.watermarkVideo)
    const base = projectInfo
      ? { ...projectInfo, stage: projectInfo.stage || 'FINISHED' }
      : { stage: 'FINISHED' }
    return {
      ...base,
      id: projectId,
      resultVideo: videoUrl,
      watermarkVideo: watermarkVideoUrl,
    } as Project
  }, [artifacts.watermarkVideoUrl, projectId, projectInfo, videoUrl])

  // The API derives this, so the browser does not assemble the path itself.
  const audioUrl = projectInfo?.voiceoverAudioUrl ?? undefined
  const audioPreviewUrl = artifacts.audioPreviewUrl ?? null

  const initPrompt = firstOf(proj.initPrompt, tmpl.initPrompt)

  // Always fetch user-uploaded assets from storage via the attachments API.
  // storage-scanned assets are the most up-to-date source; fall back to template
  // assets (populated for demo projects) only when storage returns nothing.
  const { data: fetchedAttachments } = useQuery({
    queryKey: ['user-uploaded-assets', projectId],
    queryFn: async () => {
      const response = await fetchApiDomain<{
        assets: QuickStartTemplateAsset[]
        audioUrl: null | string
      }>(`/api/media/attachments/${projectId}`, { noThrowError: true })
      if (!response.ok) {
        return undefined
      }
      return response.data
    },
    enabled: Boolean(projectId),
    refetchOnWindowFocus: false,
    retry: 2,
  })
  const fetchedAssets = fetchedAttachments?.assets
  const assets =
    fetchedAssets && fetchedAssets.length > 0 ? fetchedAssets : storyModeTemplate?.assets

  // Combine both sources for user-uploaded audio. The attachments API only
  // returns user_uploaded/ files; the status API may return any audio path.
  const resolvedUploadedAudioUrl =
    fetchedAttachments?.audioUrl ?? audioPreviewUrl ?? artifacts.uploadedAudioUrl ?? null

  // Gate templateAudioUrl with the same producer-side filter the share page
  // uses, so TTS-rendered text-to-video projects are not misclassified as
  // Audio-to-Video on Remix. A video file in user_uploaded/ is always a
  // voice-over (product invariant), surfaced via the canonical voice_over.mp3.
  //
  // Fall back to `storyModeTemplate?.audioUrl` for homepage demo/showcase
  // projects (pushed to `/story-mode/${template.projectId}`) where the live
  // workspace is empty so `resolvedUploadedAudioUrl` is null. The helper
  // still rejects anything outside `/user_uploaded/`, so TTS templates can't
  // sneak through.
  const hasUploadedVideo = (assets ?? []).some((asset) => asset.mimeType.startsWith('video/'))
  const templateAudioUrl = pickTemplateAudioUrl({
    hasUploadedVideo,
    uploadedAudioUrl: resolvedUploadedAudioUrl ?? storyModeTemplate?.audioUrl ?? null,
    voiceoverAudioUrl: audioUrl,
  })

  return {
    assets,
    audioUrl,
    audioPreviewUrl,
    bgmBedCdnUrl: s.bgmBedCdnUrl,
    bgmBedGainDb: s.bgmBedGainDb,
    bgmEnabled: s.bgmEnabled,
    bgmModel: s.bgmModel,
    bgmRegenerated: s.bgmRegenerated,
    bgmSource: s.bgmSource,
    bgmTrackId: s.bgmTrackId,
    bgmTrackName: s.bgmTrackName,
    bgmVolume: s.bgmVolume,
    concurrentStages,
    initPrompt,
    isAccessDenied: isDeleted || !!projectError,
    isLoading: artifacts.isLoading || isProjectLoading,
    isOwner,
    lipSyncVideoVariants: artifacts.lipSyncVideoVariants,
    loopPreview,
    previewAspectRatio,
    previewProject,
    ratio,
    refetchProjectInfo,
    resultVideoThumbnail: proj.resultVideoThumbnail,
    script,
    stage,
    stageDetail,
    stageStatus,
    styleName,
    styleText,
    styleThumbnailUrl,
    sourceVoice: proj.voiceOverJson ?? tmpl.voiceOverJson ?? null,
    templateAudioUrl,
    uploadedAudioUrl: resolvedUploadedAudioUrl,
    videoUrl,
    watermarkVideoUrl: firstOf(artifacts.watermarkVideoUrl, projectInfo?.watermarkVideo),
  }
}

function detectClosestAspectRatioLabel(width: number, height: number) {
  if (!width || !height) {
    return undefined
  }
  const aspectRatio = width / height

  const ratios: Array<{ label: AspectRatio; ratio: number }> = [
    { label: '1:1', ratio: 1 },
    { label: '9:16', ratio: 9 / 16 },
    { label: '16:9', ratio: 16 / 9 },
  ]

  let closest = ratios[0]
  let minDiff = Math.abs(aspectRatio - ratios[0].ratio)

  for (const r of ratios) {
    const diff = Math.abs(aspectRatio - r.ratio)
    if (diff < minDiff) {
      minDiff = diff
      closest = r
    }
  }

  return closest.label
}

function firstOf<T>(...values: (null | T | undefined)[]): T | undefined {
  return values.find((v): v is T => v !== null && v !== undefined)
}

function orEmpty<T extends object>(v: null | T | undefined): Partial<T> {
  return v ?? {}
}
