import { Images, ImagesAndTexts, TemplateRatio } from '@reelmakeeasy/common/template/type'
import { Area } from '@reelmakeeasy/common/types/video-script'
import { TranscriptWord } from '@shared/types/agent/transcript'
import z from 'zod'

import { SourceTag } from '../../types/storyloader'

export enum LayerType {
  background = 'background',
  image = 'image',
  image_covered = 'image_covered',
  text = 'text',
}

export enum MotionType {
  camera_blur = 'object_camera_blur',
  keep_static = 'object_static', // Modify for better naming
  pop_up = 'object_zoom', // Pop up to show the layer, the motino name should be renamed to object_pop_up
  slide_bottom = 'object_slide_bottom',
  slide_left = 'object_slide_left',
  slide_right = 'object_slide_right',
  slide_top = 'object_slide_top',
  slow_rotate = 'object_slow_rotate',
  turn_grey = 'object_turn_grey',
  turn_red = 'object_turn_red',
}

export enum TextMotionType {
  text_directly_appear = 'text_directly_appear',
  text_gradually_appear = 'text_gradually_appear',
  text_pop_up = 'text_pop_up',
  text_slide_bottom = 'text_slide_bottom',
}

export interface AgentToolContext {
  /** Unique identifier for the asset being processed */
  assetId: string
  /** List of associated asset IDs relevant to the current tool operation */
  assetIds: string[]
  /** Type of the asset being processed */
  assetType: 'audio' | 'chart' | 'media'
  /** Current iteration index of the agent loop */
  loopIndex: number
  /** Whether to save editing script history */
  saveHistory: boolean
}

export interface AgentToolInput<TContent> {
  content: TContent
  context: Partial<AgentToolContext>
}

export type AiFinalRenderPlan = {
  previewImage: string
  sceneId: string
  shotId: string
  videoPath: string
}
export type Asset = {
  assetId: string
  data_path: string
  description: string
  evaluation: {
    quality_score: string
    reasoning: string
    recommendation: string
    relevance_score: string
  }
  metadata: {
    matchedSentence?: string
    metadata: unknown
    requiredByUser?: boolean
    source_query: string
    sourceTag?: SourceTag
  }
  preview_path: string
  reasoning: string
  type: string
}
export type AssetAnnotatedScript = AssetGroup[]
export type AssetGroup = {
  assets: Asset[]
  intent: string
  intentId: string
  intentRationale: string
  relatedSceneIds?: string[]
}
export type AssetManifest = {
  assets: Array<{
    asset_id: string // Asset id, unique identifier for the asset
    asset_path: string // Path to the asset file
    composition_potential: string
    description: string
    dominant_colors: string[]
    key_features: string[]
    lighting_mood: string
    relationship_to_other_assets: string
    usage_context: string
    visual_style: string
  }>
  overall_cohesion: string
  recommended_composition_style: string
}
export type AssetReference = {
  dataPath: string
  description: string
  id: string
  imagePath: string
  path?: string
  ranking?: number
  reasoning?: string
  relevancyScore?: number
  type: 'article_animation' | 'image' | 'tweet' | 'video'
  usefulness?: AssetUsefulness
}

export type AssetUsefulness = 'partlyuseful' | 'perfect' | 'rejected'

/**
 * Asset tracker for managing asset usage across multiple plans
 * - consumed: Asset IDs that are newly consumed in the current plan
 * - used: All asset IDs that have been used (including previously used + newly consumed)
 * Note: This tracker now uses asset IDs instead of paths for better accuracy
 */
export type AssetTracker = {
  consumed: Set<string>
  used: Set<string>
}
export type BackgroundAsset = {
  desc: string
  id: string
  uri: string
}
export type BackgroundLayer = {
  color?: null | string
  description: string
  type: 'pure_color' | 'rich_content'
}
export type Box2D = [number, number, number, number]
export type CombinedLayer = {
  box_2d: Box2D
  depth: number
  id: number
  layer_description: string
  layer_type: LayerType
  motion_trigger_time?: number
  motion_type?: MotionType | TextMotionType
  should_cutout?: boolean
  text_color?: null | string
  text_content?: null | string[]
  text_font?: null | string
  text_lines?: null | number
}
export type DetailedDescriptionWithImageProcessing = {
  assets_to_use: Array<{
    asset_id: string
  }>
  detailed_shot_layout_description: string // The detailed shot layout description
}
export type EvaluatorImageCandidate = {
  consumedAssetDetails: AssetReference[]
  imagePath: string
  motionDescription: null | string
  planId: string
}
export type FillingStrategy = {
  // TODO: should clear these fields after research-tools is done
  aiNegativePrompt?: string
  aiPrompt?: string
  assetId?: string
  compositionImages?: string[]
  content?: string
  fillMethod?: string
  id: string
  rwaPath?: string
  type: string
}
export type FinalRenderPlan = Array<{
  box_2d: number[]
  content?: string
  id: number
  layer_description: string
  layer_type: LayerType
  motion_end_time?: number
  motion_trigger_time?: number
  motion_type?: MotionType | TextMotionType
  original_layer_type: LayerType
  path: string
  text_color?: string
  text_font?: string
  text_font_uri?: string
  text_lines?: number
}>

export interface GenImageContent {
  outputDir: string
  prompt: string
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto' | null
}

export type GenImageInput = AgentToolInput<GenImageContent>
export type GenImageOutput = {
  height: number
  path: string
  width: number
}
export type ImageAsset = Images<'a_1'>['images'][number] | Images<'a_2'>['images'][number]
export type LayerDefinition = {
  background?: BackgroundLayer
  layers?: Array<CombinedLayer>
}
export type LayerMotionAssignment = {
  id: number
  motion_trigger_time: number
  motion_type: MotionType | TextMotionType
  rationale?: string
}
export type LayerRefinementSuggestion = {
  action: 'keep' | 'refine'
  id: number
  reason?: string
  suggested_layer_description?: string
  suggested_layer_type?: LayerType
  suggested_text_lines?: number
}
export type LayersMotionAssignment = {
  description: string
  layers: LayerMotionAssignment[]
}
export type LayersWithDescription = Array<{
  asset_id: string // The asset id of the asset, it can be empty if it is a background or pure text layer
  box_2d: number[] // The box 2d of the layer. The box_2d should be [ymin, xmin, ymax, xmax] normalized to 0-1000.
  id: number
  layer_description: string
  layer_type: LayerType
  motion_trigger_time?: number
  motion_type?: MotionType | TextMotionType
  should_cutout?: boolean
  text_content?: string[] // The actual text content for each line. Only present when layer_type is "text"
  text_lines?: number // The number of text lines in the layer. Only present when layer_type is "text"
}>
export type LayerWithBox2D = {
  box_2d: number[]
  layer_description: string
  layer_type: LayerType
  motion_trigger_time?: number
  motion_type?: MotionType | TextMotionType
  text_content?: string[]
  text_lines?: number
}
export type Line = {
  asset_ids: string[]
  id: string
  text: string
}
export type PathResult = {
  /** Array of asset IDs (not paths) that were consumed by this plan */
  consumedAssets: string[]
  destPath: string
  imageGenCount?: number
  motionDescription: null | string
  planId: string
  shotVideoScript: ShotVideoScript
  type: PlanType
}
export type PlanResult = {
  /** Array of asset IDs (not paths) that were consumed by this plan */
  consumedAssets: string[]
  imageGenCount?: number
  motionDescription: null | string
  planId: string
  planPath: string
}
export type PlanType = 'ai' | 'codegen' | 'fallback' | 'fixed' | 'videoGenAimg'
export type PlanTypeResultTracker = {
  attempt: Record<PlanType, number>
  // Fixed template breakdown: avatar vs image vs video (mutually exclusive)
  fixedAssetType: {
    avatar: number
    image: number
    video: number
  }
  result: Record<PlanType, number>
  // Map of shotId to the template type used for that shot
  shotTemplates: Record<string, PlanType>
}
export type Scene = SemanticScene & {
  scene_id: string
}

// Scene with shots data structure for split shots
export type SceneWithShots = {
  avatar?: boolean
  duration: number
  scene_id: string
  shots: Shot[]
  use_avatar?: boolean
  voice_over: string
}

export interface SemanticScene {
  duration: number
  text: string
  time_range: [number, number]
  words: TranscriptWord[]
}

// Shot data structure for split shots
export type Shot = {
  duration: number
  shot_id: string
  time_range: {
    end: number
    start: number
  }
  voice_over: string
}
export type ShotVideoScript = Array<{
  content: {
    layoutId: string
    params: TemplateParams
    targetAreas?: Area[]
  }
  segId?: string
  timeline?: {
    in: number
    out: number
  }
}>
// Complete split shots data structure
export type SplitShots = SceneWithShots[]
export type Storyboard = StoryboardScene[]
export type StoryboardScene = {
  duration: number
  scene_description: string
  scene_id: string
  scene_image?: string
  shots: StoryboardShot[]
  use_avatar?: boolean | null
  voice_over: string
}
export type StoryboardShot = {
  backup_template_group?: string
  backup_template_id?: string
  duration: number
  shot_description: string
  shot_id: string
  template_group: string
  template_id: string
  time_range?: null | {
    end: number
    start: number
  }
  visual_elements: string[]
  voice_over: string
}
export type TemplateAsset = BackgroundAsset | ImageAsset
export type TemplateJson = {
  codegen_file_path?: string
  duration: number
  params: TemplateParams
  reasoning?: string
  shot_description: string
  shot_id: string
  template_description: string
  template_id: string
}
export type TemplateParams = Partial<ImagesAndTexts<string, string>>
export type ToolConfiguration = {
  delimiters?: string[]
  MAX_SCENE_DURATION: number
  MIN_FRAGMENT_DURATION: number
  MIN_SCENE_DURATION: number
}
export type YoutubeVideoAsset = {
  description: string
  endTimeMs: number
  file_path: string
  storedVideoUri?: string
  id: string
  local_path: string
  query: string
  sceneId: string
  score: number
  source_video_id: string
  sourceId?: string
  startTimeMs: number
  youtubeSearchCompletedAtMs?: number
  youtubeSearchDurationMs?: number
}
export type YoutubeVideoResponse = {
  results: Array<{
    clipUri: string
  }>
  sourceId: string
  sourceVideoReady: boolean
}

/**
 * Single plan trace entry for recording plan information
 */
export interface PlanTraceEntry {
  consumedAssets: string[]
  motionDescription?: null | string
  type: PlanType
}

/**
 * Extended plan trace for the chosen plan, includes reason from evaluator
 */
export interface ChosenPlanTrace extends PlanTraceEntry {
  reason?: string
}

/**
 * Shot-level trace for tracking asset usage and plan decisions
 */
export interface ShotTrace {
  addedAssets: string[]
  availableTools: PlanType[]
  chosenPlan?: ChosenPlanTrace
  plans: PlanTraceEntry[]
  recommendedTools?: PlanType[]
  shotId: string
  timestamp: string
  usedAssetsAfter: string[]
  usedAssetsBefore: string[]
}

/**
 * Scene-level asset trace for debugging and analysis
 */
export interface SceneAssetTrace {
  endTime?: string
  finalUsedAssets: string[]
  sceneId: string
  shots: ShotTrace[]
  startTime: string
}

/**
 * Result of processing a single shot
 */
export interface ShotProcessingResult {
  imagePath?: string
  message?: string
  shotId: string
  status: 'aborted' | 'error' | 'success'
  videoScriptOutputPath?: string
}

/**
 * Create a new asset tracker with optional initial used assets
 */
export function createAssetTracker(initial?: Set<string>): AssetTracker {
  return {
    consumed: new Set<string>(),
    used: new Set(initial ? Array.from(initial) : []),
  }
}

/**
 * Filter out assets that have already been used
 * Supports both ID-based and path-based matching for backward compatibility
 */
export function filterAvailableAssets<
  T extends { dataPath: string; id: string; imagePath: string },
>(tracker: AssetTracker | undefined, assets: T[]): T[] {
  if (!tracker) {
    return assets
  }
  return assets.filter((asset) => {
    // If asset has id field, check by id (preferred)
    if (asset.id) {
      return !tracker.used.has(asset.id)
    }
    // // Otherwise, fall back to path-based matching (backward compatibility)
    // return !tracker.used.has(asset.path)
  })
}

/**
 * Mark a single asset as used in the tracker
 * The identifier can be either an asset ID or a path (for backward compatibility)
 */
export type ImageUnderstandingOutput = {
  objectList: string[]
  reasoning: string
}

export function markConsumed(tracker: AssetTracker | undefined, assetId?: string): void {
  if (!tracker || !assetId) {
    return
  }
  tracker.consumed.add(assetId)
}

export const PythonCutoutResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  output_path: z.string().optional(),
  num_objects: z.number().optional(),
  detected_objects: z
    .array(
      z.object({
        label: z.string(),
        confidence: z.number(),
        bbox: z.array(z.number()),
        mask_id: z.number(),
      }),
    )
    .optional(),
  metadata: z
    .object({
      image_size: z.object({
        width: z.number(),
        height: z.number(),
      }),
      text_prompt: z.string(),
      box_threshold: z.number(),
      text_threshold: z.number(),
      device: z.string(),
      masks_shape: z.array(z.number()),
    })
    .optional(),
})

export type CheckReframeResult = {
  reason: string
  shouldReframe: boolean
  videoMetadata?: SimpleVideoMetadata
}

export interface DetectedSubject {
  aliases: string[]
  crop_focus?: 'body' | 'face' | 'whole'
  evidence: SubjectEvidence
  label: string
  location_hint?: SubjectLocationHint
}

export interface ImageMetadata {
  format: string
  height: number
  width: number
}

export interface NoSubjectOutput {
  confidence: 'high' | 'low' | 'medium'
  crop_box: [number, number, number, number] | undefined
  has_face?: boolean
  important_content_box?: [number, number, number, number]
  important_content_ratio?: number
  is_text_rich?: boolean
  mobile_score: number
  mode: 'no_subject'
  reasoning: string
  scenario?:
    | 'abstract_patterns'
    | 'charts_diagrams'
    | 'collages_montages'
    | 'landscapes_scenery'
    | 'scattered_no_dominant'
    | 'screenshot'
    | 'split_screen_comparison'
    | 'subject_critical_content'
    | 'text_logo'
  treatment: 'crop' | 'pillar_box'
}

export type PythonCutoutResponse = z.infer<typeof PythonCutoutResponseSchema>

export interface ReframerCropOrPillarBoxInput {
  frameDimensions?: { height: number; width: number } // Actual frame dimensions for accurate crop calculation
  imageDescription: string
  imageFolderPath: string
  ratio: TemplateRatio
  shotContext: string
  useAs: UseAs
}

export interface ReframerSubjectDetectionForImageInput {
  frameDimensions?: { height: number; width: number } // Actual frame dimensions for accurate crop calculation
  imageDescription: string
  imagePath: string
  ratio: TemplateRatio
  shotContext: string
  useAs: UseAs
}

export type ReframerSubjectDetectionModelOutput = NoSubjectOutput | SubjectIdentifiedOutput

export interface ReframerSubjectDetectionOutput {
  confidence: 'high' | 'low' | 'medium'
  cropBox?: [number, number, number, number]
  frameConsistencyScore?: number
  gdinoQuery?: string[]
  hasFace?: boolean
  importantContentBox?: [number, number, number, number]
  importantContentRatio?: number
  isHumanSubject?: boolean
  isTextRich?: boolean
  mobileScore?: number
  mode: 'no_subject' | 'subject_identified'
  reasoning: string
  scenario?:
    | 'abstract_patterns'
    | 'charts_diagrams'
    | 'collages_montages'
    | 'landscapes_scenery'
    | 'scattered_no_dominant'
    | 'screenshot'
    | 'split_screen_comparison'
    | 'subject_critical_content'
    | 'text_logo'
  subjectCount?: number
  subjects?: DetectedSubject[]
  treatment?: 'crop' | 'pillar_box'
}

export type SimpleVideoMetadata = {
  dar: number
  displayHeight: number
  displayWidth: number
  height: number
  rotate: number
  sar: string
  width: number
}

// Subject Detection Types
export interface GroundingDINOBox {
  bbox: [number, number, number, number] // [x1, y1, x2, y2] in pixels
  label: string
  score: number
}

export interface SubjectEvidence {
  avg_screen_coverage: number
  frame_presence_ratio: number
}

export interface SubjectIdentifiedOutput {
  confidence: 'high' | 'low' | 'medium'
  frame_consistency_score: number
  gdino_query: string[]
  has_face?: boolean
  is_human_subject?: boolean
  is_text_rich?: boolean
  mode: 'subject_identified'
  reasoning: string
  subjects: DetectedSubject[]
}

export interface SubjectLocationHint {
  box?: [number, number, number, number] // [x, y, w, h] for box type
  cx?: number // For point type
  cy?: number // For point type
  type: 'box' | 'point'
}

export type UseAs = 'background' | 'focal_point' | 'foreground' | string

// Re-export config type for external use (all fields optional for override)

export interface GroundingDINOOutput {
  boxes_per_query: { [query: string]: GroundingDINOBox[] }
  device_used: string
  image_h: number
  image_w: number
  model_id: string
  thresholds: {
    box_threshold: number
    text_threshold: number
  }
}

// Reframe types
export type ImageToVideoParams = {
  analyzedDuration: number
  assetPaths: string[]
  desc: string
  ratio: string
}

export type ReframedRatio = `${number}:${number}`

export type ReframeInput = {
  analyzedDuration?: number
  assetDescription: string
  assetPath: string
  context?: ReframeContext // Optional for backward compatibility
  cutout?: boolean
  ratio: string
  shotContext: string
  useAs: string
  workDir: string
}

export type ReframeResult = {
  originalPath: string
  reframedRatio?: ReframedRatio
  updatedPath?: string
}

/**
 * Context for reframe trace collection
 */
export interface ReframeContext {
  assetId: string
  projectId: string
  sceneId: string
  shotId: string
}

/**
 * Avatar request map for async avatar generation
 * Maps sceneId to request information
 */
export interface AvatarRequestMap {
  [sceneId: string]: {
    requestId: string
    submittedAt: string
  }
}

export type MotionDesignerMessages = {
  [sceneId: string]: string[]
}
