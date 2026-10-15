import { Texture, TextureTemplateName } from './type'
import { getBgPath, getTexturePath } from './utils'

export const textureSize: Record<keyof Texture, { h: number; w: number }> = {
  v_text_bg_1: { h: 300, w: 1000 },
  v_text_bg_2: { h: 300, w: 1000 },
  v_text_bg_3: { h: 300, w: 1000 },
  v_text_bg_4: { h: 300, w: 1000 },
  v_top_text_bg_1: { h: 557, w: 1020 },
}

export const textureTemplate: Record<
  TextureTemplateName,
  Record<keyof Texture | string, string>
> = {
  brush: {
    bg_dark: getBgPath('brush', 'bg_dark'),
    bg_light: getBgPath('brush', 'bg_light'),
    bg_paper_2: getBgPath('brush', 'bg_paper_2'),
    v_text_bg_1: getTexturePath('brush', 'v_text_bg_1'),
    v_text_bg_2: getTexturePath('brush', 'v_text_bg_2'),
    v_text_bg_3: getTexturePath('brush', 'v_text_bg_3'),
    v_text_bg_4: getTexturePath('brush', 'v_text_bg_4'),
    v_top_text_bg_1: getTexturePath('brush', 'v_top_text_bg_1'),
  },
  paper: {
    bg_dark: getBgPath('paper', 'bg_dark'),
    bg_light: getBgPath('paper', 'bg_light'),
    bg_paper_2: getBgPath('paper', 'bg_paper_2'),
    v_text_bg_1: getTexturePath('paper', 'v_text_bg_1'),
    v_text_bg_2: getTexturePath('paper', 'v_text_bg_2'),
    v_text_bg_3: getTexturePath('paper', 'v_text_bg_3'),
    v_text_bg_4: getTexturePath('paper', 'v_text_bg_4'),
    v_top_text_bg_1: getTexturePath('paper', 'v_top_text_bg_1'),
  },
} // Mapping from BaseTemplate keys to LayoutTemplateParams keys

export const templateKeyMapping = {
  'annotation-circle': 'object_circle_zoom_emphasis' as const,
  'bg-grid-b': 'bg-grid-b' as const,
  'bg-texture': 'bg-texture' as const,
  bg_dark: 'bg_dark' as const,
  'chart-bar-1': 'bar_chart_overlay_blur_background_data' as const,
  fullscreen: 'fullscreen' as const,
  'image-1-lg': 'top_text_medium_size_summary' as const,
  'image-1-people-1': 'small_object_large_people_explain' as const,
  'image-1-people-1-p1': 'small_object_large_people_explain_a1' as const,
  'image-1-people-1-p2': 'small_object_large_people_explain_a2' as const,
  'image-1-slow-pan': 'full_image_slow_pan_left_storytelling' as const,
  'image-1-slow-zoom': 'full_image_slow_zoom_storytelling' as const,
  'image-1-sm': 'centred_one_sticker_popup_emphasis' as const,
  'image-1-title-1-sm': 'top_title_mid_body_sticker_info' as const,
  'image-1-title-2': 'top_text_large_size_intro' as const,
  'image-2-horizontal': 'centred_two_sticker_popup_compare' as const,
  'image-2-horizontal-p1': 'centred_two_sticker_popup_compare_a1' as const,
  'image-2-horizontal-p2': 'centred_two_sticker_popup_compare_a2' as const,
  'impact-zoom': 'full_image_fast_zoom_emphasis' as const,
  'people-2': 'two_people_mention' as const,
  'people-2-p1': 'two_people_mention_a1' as const,
  'people-2-p2': 'two_people_mention_a2' as const,
  'title-1': 'top_bar_summary' as const,
  'title-1-sm': 'left_text_small_size_explain' as const,
  'title-desc': 'centered_text_emphasis' as const,
  'title-explain': 'top_title_mid_body_info' as const,

  'title-number': 'centered_number_blur_background_data' as const,
  'transition-camera-pan': 'transition-camera-pan' as const,
  'transition-flash-blur': 'transition-flash-blur' as const,
  twitter: 'twitter_quote' as const,
}

export const remotionType = [
  templateKeyMapping['chart-bar-1'],
  templateKeyMapping['title-number'],
  templateKeyMapping['twitter'],
  'centered_desc_growing_number',
  'centered_text_emphasis',
  'animated_title_1',
  'animated_title_2',
  'animated_title_3',
  'article_quote_1',
  'article_quote_2',
  'article_quote_3',
  'title_desc_hand_write',
  'bar_chart_two_overlay_blur_background_data',
]

export const CODEGEN_LAYOUT_ID = 'codegen' as const

export const TemplateMapMotionName = {
  object_circle_zoom_emphasis: 'Circular annotation with zoom emphasis effect',
  article_quote_1:
    'Logo, headline, body text, byline fade in. Image slides in like a digital article.',
  article_quote_2:
    'Logo, author, headline, body text, byline fade in. Content slides in like a digital article while the image zooms in on the top.',
  article_quote_3:
    'Logo, author, headline, body text, byline fade in. Content page slides in like a digital article.',
  'bg-grid-b': 'Grid background template',
  'bg-texture': 'Textured background template',
  bg_dark: 'Dark background template',
  bar_chart_overlay_blur_background_data: 'Vertical bar fills up with percent counter.',
  fullscreen:
    'Plays full-screen video with no overlays. This template is the most flexible template could be used in any situations.',
  top_text_medium_size_summary:
    'Image pops from center; torn paper title wipes on. Central photo expands as the ripped title reveals left-to-right. Blueprint grid: image zooms in, title banner slides on.',
  small_object_large_people_explain: 'Person slides in from bottom, object pops in from top.',
  small_object_large_people_explain_a1:
    'Person slides in from bottom, object pops in from top. (Animation variant 1)',
  small_object_large_people_explain_a2:
    'Person slides in from bottom, object pops in from top. (Animation variant 2)',
  full_image_slow_pan_left_storytelling: 'Slow horizontal pan.',
  full_image_slow_zoom_storytelling: 'Slow zoom in to focus viewers attention.',
  centred_one_sticker_popup_emphasis: 'Single sticker-like image pops up with emphasis effect',
  top_title_mid_body_sticker_info: 'Torn paper title unrolls, followed by typing bullet points.',
  top_text_large_size_intro:
    'Present the main topic or chapter of your video. Emphasize a powerful quote from someone. Showcase a product or object.',
  centred_two_sticker_popup_compare:
    'Two sticker-like images pop up sequentially. First illustration appears, then the second follows.',
  centred_two_sticker_popup_compare_a1:
    'Two sticker-like images pop up sequentially. (Animation variant 1)',
  centred_two_sticker_popup_compare_a2:
    'Two sticker-like images pop up sequentially. (Animation variant 2)',
  full_image_fast_zoom_emphasis: 'Fast punch-in zoom on subject.',
  two_people_mention: 'Two cutouts slide up one by one from the bottom of the frame.',
  two_people_mention_a1:
    'Two cutouts slide up one by one from the bottom of the frame. (Animation variant 1)',
  two_people_mention_a2:
    'Two cutouts slide up one by one from the bottom of the frame. (Animation variant 2)',
  top_bar_summary: 'Paper tape title animates across the footage.',
  left_text_small_size_explain:
    'Text label appears, followed by an animated arrow pointing to an object.',
  centered_text_emphasis: 'Text appears on screen; key word is highlighted.',
  top_title_mid_body_info: 'Paper banner animates in, then text list appears.',

  centered_number_blur_background_data: 'Blurred background with animated number counting up.',
  'transition-camera-pan': 'Camera pan transition effect',
  'transition-flash-blur': 'Flash blur transition effect',
  twitter_quote: 'Twitter/X logo expands into full tweet graphic.',
  centered_desc_growing_number: 'Centered description with growing number.',
} as const
