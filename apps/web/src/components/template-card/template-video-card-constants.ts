import { Project } from '@shared/types/api/project'
import { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import React from 'react'

import { VideoFilterCategory } from '../navigation/consts'

export const FONT_FEATURE = "'ss01' on, 'ss03' on, 'ss04' on, 'ss06' on, 'ss08' on"

export const inProgressTextStyle: React.CSSProperties = {
  color: 'var(--Text-secondary, rgba(255, 255, 255, 0.50))',
  fontSize: '14px',
  fontWeight: 500,
  fontStyle: 'normal',
  lineHeight: '17px',
  fontFeatureSettings: FONT_FEATURE,
  textAlign: 'center',
}

export const percentageStyle: React.CSSProperties = {
  color: 'var(--Text-secondary, rgba(255, 255, 255, 0.50))',
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: '17px',
  fontFeatureSettings: FONT_FEATURE,
  textAlign: 'center',
}

export const failedTextStyle: React.CSSProperties = {
  color: 'var(--Status-error, #CF4020)',
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: '17px',
  fontFeatureSettings: FONT_FEATURE,
  textAlign: 'center',
}

export type CardAspectRatio = '1:1' | '9:16' | '16:9'

export type PreviewMode = 'eager-autoplay' | 'eager-hover' | 'lazy-hover'

export interface PreviewModeBehavior {
  isEagerMode: boolean
  preload: 'auto' | 'metadata' | 'none'
  shouldAutoPlay: boolean
}

export interface TemplateVideoCardProps {
  activeFilterCategory?: VideoFilterCategory
  aspectRatio?: CardAspectRatio
  onClickInitialIndex: () => void
  previewMode?: PreviewMode
  project?: Project
  showInputTypeBadge?: boolean
  template: QuickStartTemplate & {
    goals?: string[]
    industries?: string[]
    industry?: string
    username?: string
  }
}

// On mobile, only eager-autoplay is allowed through (viewport-gated, safe).
// Everything else (eager-hover, lazy-hover, undefined) degrades to lazy-hover
// to avoid unbounded preload. New PreviewMode values default to lazy-hover on
// mobile unless explicitly added to this allowlist.
export function deriveEffectivePreviewMode(
  mode: PreviewMode | undefined,
  isMobile: boolean,
): PreviewMode {
  const resolved = mode ?? 'lazy-hover'
  if (isMobile) {
    return resolved === 'eager-autoplay' ? resolved : 'lazy-hover'
  }
  return resolved
}

export function resolvePreviewModeBehavior(mode: PreviewMode): PreviewModeBehavior {
  switch (mode) {
    case 'eager-autoplay': {
      // preload='none': the VisibilityComponent mounts the <video> element up
      // to 2400px before it is visible. Fetching on mount would waste bandwidth
      // on cards the user may never reach. Network activity is deferred until
      // the 200px IntersectionObserver calls .play(), which implicitly starts
      // loading at the right time.
      //
      // shouldAutoPlay=false: playback is gated on the 200px IntersectionObserver
      // inside TemplateVideoCard, not the browser autoplay attribute. This
      // prevents the off-screen decode stampede when dozens of cards mount
      // near-simultaneously within the VisibilityComponent buffer.
      return { isEagerMode: true, preload: 'none', shouldAutoPlay: false }
    }
    case 'eager-hover': {
      return { isEagerMode: true, preload: 'none', shouldAutoPlay: false }
    }
    default: {
      return { isEagerMode: false, preload: 'none', shouldAutoPlay: false }
    }
  }
}

export const ASPECT_RATIO_CLASS: Record<CardAspectRatio, string> = {
  '9:16': 'aspect-[9/16]',
  '16:9': 'aspect-[16/9]',
  '1:1': 'aspect-[1/1]',
}

export const HOVER_ANIMATION_DURATION = 0.18
export const HOVER_PREVIEW_CROSSFADE_DELAY_MS = 80

const MOTION_DESIGNER_PREFIX = /^@motion-designer\s*/i

const STORY_MODE_HOVER_GLASS_GRADIENT =
  'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(0, 0, 0, 0.08) 35%, rgba(0, 0, 0, 0.34) 100%)'
const STORY_MODE_RESTING_GLASS_GRADIENT =
  'linear-gradient(180deg, rgba(0, 0, 0, 0.00) 0%, rgba(0, 0, 0, 0.10) 100%)'
const STORY_MODE_RESTING_GLASS_MASK =
  'linear-gradient(180deg, rgba(0, 0, 0, 0.00) 0%, rgba(0, 0, 0, 0.28) 16%, rgba(0, 0, 0, 0.68) 38%, rgba(0, 0, 0, 1.00) 72%, rgba(0, 0, 0, 1.00) 100%)'

export const STORY_MODE_HOVER_GLASS_GRADIENT_STYLE: React.CSSProperties = {
  background: STORY_MODE_HOVER_GLASS_GRADIENT,
}

export const STORY_MODE_RESTING_GLASS_GRADIENT_STYLE: React.CSSProperties = {
  background: STORY_MODE_RESTING_GLASS_GRADIENT,
  maskImage: STORY_MODE_RESTING_GLASS_MASK,
  WebkitMaskImage: STORY_MODE_RESTING_GLASS_MASK,
}

export const STORY_MODE_RESTING_GLASS_BLUR_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(0, 0, 0, 0.03)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  maskImage: STORY_MODE_RESTING_GLASS_MASK,
  WebkitMaskImage: STORY_MODE_RESTING_GLASS_MASK,
  backfaceVisibility: 'hidden',
  transform: 'translateZ(0)',
}

export type OverlayContent = null | {
  icon?: React.ReactNode
  label: string
  showPercentage?: boolean
  subtext?: string
  subtextStyle?: React.CSSProperties
}

export function computeIsProcessing(
  showOnProjectsPage: boolean,
  project: Project | undefined,
  flags: {
    isLongTakeInProcess: boolean
    showProcessingWithoutProgress: boolean
    showProgress: boolean
  },
): boolean {
  if (!showOnProjectsPage || !project) {
    return false
  }
  return (
    project.stage === PROJECT_STAGE.FAILED ||
    project.stage === PROJECT_STAGE.CANCELED ||
    project.stage === PROJECT_STAGE.INITIALIZING ||
    flags.isLongTakeInProcess ||
    flags.showProgress ||
    flags.showProcessingWithoutProgress
  )
}

export function getExportLabel(isDownloading: boolean, showWatermarkDownload: boolean): string {
  if (isDownloading) {
    return 'Exporting...'
  }
  return showWatermarkDownload ? 'Export with watermark' : 'Export'
}

export function getStoryModeCardStyleLabel(template: TemplateVideoCardProps['template']): string {
  return (
    getNonEmptyString(template.styleName) ||
    getNonEmptyString(template.styleText) ||
    getTemplateDisplayTitle(template)
  )
}

export function getStoryModeCardSubtitle(template: TemplateVideoCardProps['template']): string {
  if (template.assets && template.assets.length > 0) {
    return 'Asset to video'
  }
  if (template.audioUrl) {
    return 'Audio to video'
  }
  return 'Text to video'
}

// The card's top-left badge: its input type (e.g. "Video").
export function getTemplateCardBadgeLabel(template: TemplateVideoCardProps['template']): string {
  return getNonEmptyString(template.inputType) || 'Video'
}

export function getTemplateDisplayIndustry(
  template: TemplateVideoCardProps['template'],
): null | string {
  if (template.projectType === 'STORY_MODE') {
    return getNonEmptyString(template.styleName) || getNonEmptyString(template.styleText) || null
  }
  return (
    getNonEmptyString(template.industries?.[0]) ||
    getNonEmptyString(template.industry) ||
    getNonEmptyString(template.useCases?.[0]) ||
    null
  )
}

export function getTemplateDisplayTitle(template: TemplateVideoCardProps['template']): string {
  const explicitTitle = getNonEmptyString(template.title)
  if (explicitTitle) {
    return explicitTitle
  }

  const promptTitle = getNonEmptyString(template.initPrompt?.replace(MOTION_DESIGNER_PREFIX, ''))
  if (promptTitle) {
    return promptTitle
  }

  return (
    getNonEmptyString(template.motionDescription) ||
    getNonEmptyString(template.shotDescription) ||
    getNonEmptyString(template.styleDescription) ||
    'Untitled'
  )
}

function getNonEmptyString(value: unknown): null | string {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Determines whether the <video> element should be mounted for a card.
 *
 * In eager modes the card is mounted 240 px before it enters the viewport so
 * the browser can prefetch. The guard on `hasPreviewVideo` prevents the
 * browser from silently falling back to `resultVideo` (30-65 MB) when no
 * lightweight preview exists, which would cause unbounded range-request loops
 * under memory pressure.
 */
export function resolveVideoMountCondition(opts: {
  hasPreviewVideo: boolean
  isEagerMode: boolean
  showHoverVideoPreview: boolean
  visible: boolean
}): boolean {
  const { hasPreviewVideo, isEagerMode, showHoverVideoPreview, visible } = opts
  return visible && (isEagerMode ? hasPreviewVideo : true) && (isEagerMode || showHoverVideoPreview)
}

/**
 * Returns the URL that should be fed to the <video> element.
 *
 * In eager mode only the lightweight `previewVideo` is used. Falling back to
 * `resultVideo` in eager mode is explicitly forbidden: a 404 on the preview
 * would silently trigger a 30-65 MB download and defeat the memory budget.
 */
export function resolveVideoUrl(opts: {
  isEagerMode: boolean
  previewVideo?: string
  resultVideo?: string
}): string {
  const { isEagerMode, previewVideo, resultVideo } = opts
  if (isEagerMode) {
    return previewVideo ?? ''
  }
  return previewVideo || resultVideo || ''
}

export { PROJECT_STAGE }
