import type React from 'react'

import { Area, Timeline } from '../types/video-script'

export type Images<T extends string> = {
  images: Array<{
    cdnUri?: string
    cropAreas?: Area[]
    desc: string
    id: T
    previewSourceUri?: string
    timeline?: Timeline
    uri: string
  }>
}

export type ImagesAndTexts<I extends string, T extends string> = Images<I> &
  Texts<T> & {
    background?: {
      cropAreas?: Area[]
      desc: string
      id: string
      previewSourceUri?: string
      uri: string
    }
  }

export type LayoutTemplateParams = {
  animated_title_1: ImagesAndTexts<'a_1', 'description'>
  animated_title_2: ImagesAndTexts<'a_1', 'description'>
  animated_title_3: ImagesAndTexts<'a_1', 'description' | 'highlight'>
  animated_title_5: ImagesAndTexts<'a_1', 'title_line_1' | 'title_line_2'>
  animated_title_6: ImagesAndTexts<'a_1', 'title_line_1' | 'title_line_2' | 'title_line_3'>
  animated_title_7: ImagesAndTexts<'a_1', 'title_line_1' | 'title_line_2'>
  animated_word_1: ImagesAndTexts<'a_1', 'title_line_1'>

  animated_word_2: ImagesAndTexts<'a_1', 'title_line_1'>
  animated_word_3: ImagesAndTexts<'a_1', 'title_line_1'>
  animated_word_4: ImagesAndTexts<'a_1', 'title_line_1'>

  animated_word_5: ImagesAndTexts<'a_1', 'title_line_1' | 'title_line_2'>

  article_quote_1: ImagesAndTexts<'a_1' | 'a_2', 'date' | 'description' | 'highlight' | 'title'>

  article_quote_2: ImagesAndTexts<
    'a_1' | 'a_2',
    'author' | 'date' | 'description' | 'highlight' | 'title'
  >

  article_quote_3: ImagesAndTexts<
    'a_1' | 'a_2',
    'author' | 'date' | 'description' | 'highlight' | 'title'
  >

  bar_chart_overlay_blur_background_data: Texts<'label' | 'percent'>

  bar_chart_two_overlay_blur_background_data: Texts<
    'label_a' | 'label_b' | 'percent_a' | 'percent_b'
  >
  centered_desc_growing_number: ImagesAndTexts<'a_1', 'amount' | 'description'>
  centered_number_blur_background_data: ImagesAndTexts<'a_1', 'amount' | 'description'>
  centered_text_emphasis: Texts<'description' | 'highlight'>

  centred_one_sticker_popup_emphasis: ImagesAndTexts<'a_1', 'title'>
  centred_two_sticker_popup_compare: Images<'a_1' | 'a_2'>
  full_image_3d_perspective: Images<'a_1'>
  full_image_add_gradient: Images<'a_1'>

  full_image_add_vignettes: Images<'a_1'>

  full_image_fast_camera_pan: Images<'a_1'>
  // new templates
  full_image_fast_turn_small: Images<'a_1'>
  full_image_fast_zoom_emphasis: Images<'a_1'>
  full_image_film_shift: Images<'a_1'>
  full_image_slow_pan_left_storytelling: Images<'a_1'>
  full_image_slow_zoom_storytelling: Images<'a_1'>
  // Exception, it is not actually a template, but is used for the preceding step.
  fullscreen: { background: { cropAreas: Area[]; uri: string } }
  left_text_small_size_explain: Texts<'description'>
  line_chart_overlay_down: Texts<'title_line_1' | 'title_line_2'> & {
    color?: string
  }
  line_chart_overlay_up: Texts<'title_line_1' | 'title_line_2'> & {
    color?: string
  }

  object_circle_zoom_emphasis: object
  object_static: Images<'a_1'>
  one_people_one_title_center: ImagesAndTexts<'a_1', 'title_highlight'>
  one_people_one_title_left: ImagesAndTexts<'a_1', 'title_highlight'>
  one_people_one_title_right: ImagesAndTexts<'a_1', 'title_highlight'>
  small_object_large_people_explain: Images<'a_1' | 'a_2'>
  text_static: Texts<'title_line_1'>
  title_desc_hand_write: Texts<'description' | 'title'>
  top_bar_summary: ImagesAndTexts<'v_text_bg_3', 'title_highlight' | 'title_highlight_before'>

  top_text_large_size_intro: ImagesAndTexts<
    'a_1' | 'v_top_text_bg_1',
    'title_highlight' | 'title_highlight_after' | 'title_highlight_before'
  >
  top_text_medium_size_summary: ImagesAndTexts<
    'a_1' | 'v_text_bg_1',
    'title_highlight' | 'title_highlight_before'
  >
  top_title_mid_body_info: ImagesAndTexts<
    'v_text_bg_4',
    'description' | 'title_highlight' | 'title_highlight_before'
  >

  top_title_mid_body_sticker_info: ImagesAndTexts<
    'a_1' | 'v_text_bg_2',
    'description' | 'title_highlight' | 'title_highlight_before'
  >
  twitter_quote: ImagesAndTexts<'a_1' | 'a_2', 'content' | 'date' | 'nickname' | 'username'>
  two_people_mention: Images<'a_1' | 'a_2'>
  vertical_two_assets: Images<'a_1' | 'a_2'>

  video_1_logo_1: Images<'a_1' | 'a_2'>
}
export type Palette = {
  primary: string
  secondary: string
}

export type RenderTemplate = {
  category?: string
  createdAt: string
  desc: string
  historyFiles: string[] // storage uris (typically starts with 'store://')
  labels?: string[]
  name: string
  placeholders: Array<RenderTemplatePlaceholder>
  ratio?: RenderTemplateRatio
  status: 'Archived' | 'Draft' | 'Live'
  templateDuration?: string
  type?: RenderTemplateType
  updatedAt: string
  useCases: string
  version: number
  videoUrl?: string // Demo video URI
}

export type RenderTemplateBgPlaceholder = {
  desc: string
  id: 'bg_1'
  ratio: TemplateRatio
  type: 'background'
}

export type RenderTemplateImagePlaceholder = {
  desc: string
  id: `a_${number | string}` | `avatar_${number}`
  ratio: TemplateRatio
  type: 'image'
}

export type RenderTemplatePlaceholder =
  | RenderTemplateBgPlaceholder
  | RenderTemplateImagePlaceholder
  | RenderTemplateTextPlaceholder
export type RenderTemplateRatio = '9:16' | '16:9'
export type RenderTemplateTextNumberPlaceholder = {
  backgroundColor?: Color
  color?: Color
  contentType: 'number'
  desc: string
  id: string
  max?: number
  min?: number
  type: 'text'
}
export type RenderTemplateTextPlaceholder =
  | RenderTemplateTextNumberPlaceholder
  | RenderTemplateTextStringPlaceholder
export type RenderTemplateTextStringPlaceholder = {
  backgroundColor?: Color
  color?: Color
  contentType: 'string'
  desc: string
  id: string
  maxCharacterLength?: number
  type: 'text'
}
export type RenderTemplateType = 'asset' | 'background' | 'layout' | 'text'
export type TemplateAssetMetadata = {
  description: string
  id: string
  spec: {
    ratio: TemplateRatio
  }
  tools?: TemplateAssetTool[]
  type: TemplateAssetType[]
  useAs: TemplateAssetUseAs
}
export type TemplateAssetTool = 'cutout'
export type TemplateAssetType = 'image' | 'video'
export type TemplateAssetUseAs = 'background' | 'focal_point' | 'foreground'
export type TemplateBackend = 'omb' | 'remotion' | 'unknown'
export type TemplateGroup = {
  template_group_description: string
  template_group_name: string
  template_list: string[]
}
export type TemplateInfo = Record<
  string,
  {
    category?: string
    desc: string
    labels?: string[]
    placeholder: string
    templateDuration?: string
    useCases: string
  }
>
export type TemplateMetadata = {
  assets: Array<TemplateAssetMetadata>
  backend: TemplateBackend
  description: string
  useCase: string
}
export type TemplateParams = Record<string, Partial<ImagesAndTexts<string, string>>>
export type TemplateRatio =
  | '1:1'
  | '9:8'
  | '9:16'
  | '16:9'
  | '748:468'
  | '872:490'
  | 'any'
  | 'narrower-than-9:16'
  | 'wider-than-9:16'
export type Text<T extends string> = {
  backgroundColor?: React.CSSProperties['backgroundColor']
  color?: React.CSSProperties['color']
  content: number | string
  desc: string
  font?: { family: string; uri: string }
  highlightColor?: React.CSSProperties['backgroundColor']
  id: T
  lines?: number
}
export type Texts<T extends string> = {
  texts: Array<Text<T>>
}
export type Texture = {
  v_text_bg_1: string
  v_text_bg_2: string
  v_text_bg_3: string
  v_text_bg_4: string
  v_top_text_bg_1: string
}
export type TextureTemplateName = 'brush' | 'paper'
export type TransitionTemplateName =
  | 'transition_camera_pan_down'
  | 'transition_camera_pan_left'
  | 'transition_camera_pan_right'
  | 'transition_camera_pan_up'
  | 'transition_directional_blur'
  | 'transition_flash_blur'

type Color = '#primary' | '#secondary'
