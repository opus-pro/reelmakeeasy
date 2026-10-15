import { deleteNull } from '../../utils/delete-null'
import {
  RenderTemplate,
  RenderTemplateBgPlaceholder,
  TemplateAssetTool,
  TemplateAssetType,
  TemplateBackend,
  TemplateGroup,
  TemplateInfo,
  TemplateMetadata,
  TemplateParams,
} from '../type'

export function extractTemplatesInfo(templates: RenderTemplate[]) {
  const templatesInfo: Partial<TemplateInfo> = {}
  for (const template of templates) {
    templatesInfo[template.name] = {
      desc: template.desc,
      placeholder: template.placeholders
        .map((placeholder) => ['-', placeholder.desc].join(' '))
        .join('\n'),
      useCases: template.useCases,
      category: template.category,
      labels: template.labels,
      templateDuration: template.templateDuration,
    }
  }
  return templatesInfo as TemplateInfo
}

/**
 * Filters out codegen templates from TemplateInfo.
 * Used to exclude codegen templates when the feature is disabled.
 */
export function filterCodegenTemplates(templateInfo: TemplateInfo): TemplateInfo {
  return Object.fromEntries(
    Object.entries(templateInfo).filter(
      ([_, t]) => !t.labels?.includes(TEMPLATE_LABELS.CODEGEN_TEMPLATE),
    ),
  ) as TemplateInfo
}

/**
 * Filters TemplateInfo to only include templates with duration <= shot duration.
 * If filtering results in an empty set, returns the original templateInfo to ensure
 * at least some templates are available.
 *
 * @param templateInfo - The template info object to filter
 * @param shotDuration - The shot duration in seconds
 * @returns Filtered template info, or original if filtering would leave no templates
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function extractTemplatesParams(templates: RenderTemplate[]) {
  const templatesParams: Partial<TemplateParams> = {}
  const templatesWithImageTimeline: string[] = [
    'two_people_mention',
    'centred_two_sticker_popup_compare',
  ]
  for (const template of templates) {
    const obj: Record<string, unknown> = {
      background: null,
      images: null,
      texts: null,
    }
    let imageIndex = 0
    for (const placeholder of template.placeholders) {
      if (placeholder.type === 'background') {
        obj['background'] = {
          desc: placeholder.desc,
          id: placeholder.id,
          uri: '',
        }
      } else if (placeholder.type === 'image') {
        if (obj['images'] === null) {
          obj['images'] = []
        }
        ;(obj['images'] as Array<unknown>).push(
          deleteNull({
            desc: placeholder.desc,
            id: placeholder.id,
            uri: '',
            timeline: templatesWithImageTimeline.includes(template.name)
              ? imageIndex === 0
                ? {
                    start: 0,
                    end: 2000,
                  }
                : {
                    start: 1000,
                    end: 2000,
                  }
              : null,
          }),
        )
        imageIndex++
      } else if (placeholder.type === 'text') {
        if (obj['texts'] === null) {
          obj['texts'] = []
        }
        ;(obj['texts'] as Array<unknown>).push(
          deleteNull({
            desc: placeholder.desc,
            id: placeholder.id,
            content: placeholder?.contentType === 'number' ? 0 : '',
            color: placeholder?.color,
            backgroundColor: placeholder?.backgroundColor,
          }),
        )
      }
    }
    templatesParams[template.name] = obj
  }
  return templatesParams as TemplateParams
}

export function filterTemplateInfoByDuration(
  templateInfo: TemplateInfo,
  shotDuration: number,
): TemplateInfo {
  const filteredEntries = Object.entries(templateInfo).filter(
    ([_, t]) => Number.parseFloat(t.templateDuration ?? '0') <= shotDuration,
  )

  // Fallback to original if filtering would leave no templates
  if (filteredEntries.length === 0) {
    return templateInfo
  }

  return Object.fromEntries(filteredEntries) as TemplateInfo
}

// Backend mapping based on template names
const BACKEND_MAPPING: Record<string, TemplateBackend> = {
  // Remotion templates
  animated_title_1: 'remotion',
  animated_title_2: 'remotion',
  animated_title_3: 'remotion',
  title_desc_hand_write: 'remotion',
  centered_desc_growing_number: 'remotion',
  centered_number_blur_background_data: 'remotion',
  bar_chart_overlay_blur_background_data: 'remotion',
  bar_chart_two_overlay_blur_background_data: 'remotion',
  article_quote_1: 'remotion',
  article_quote_2: 'remotion',
  article_quote_3: 'remotion',
  twitter_quote: 'remotion',
  // Default to omb for others
}

// Asset cutout tool mapping: templateName -> assetId -> tools
const ASSET_CUTOUT_TOOLS_MAP: Record<string, Record<string, TemplateAssetTool[]>> = {
  one_people_one_title_left: {
    a_1: ['cutout'],
  },
  one_people_one_title_right: {
    a_1: ['cutout'],
  },
  one_people_one_title_center: {
    a_1: ['cutout'],
  },
  centred_one_sticker_popup_emphasis: {
    a_1: ['cutout'],
  },
  small_object_large_people_explain: {
    a_1: ['cutout'],
    a_2: ['cutout'],
  },
  two_people_mention: {
    a_1: ['cutout'],
    a_2: ['cutout'],
  },
  centred_two_sticker_popup_compare: {
    a_1: ['cutout'],
    a_2: ['cutout'],
  },
  article_quote_1: {
    a_1: ['cutout'],
  },
  article_quote_2: {
    a_1: ['cutout'],
  },
  article_quote_3: {
    a_1: ['cutout'],
  },
}

// Asset useAs mapping: templateName -> assetId -> useAs
const ASSET_USE_AS_MAP: Record<
  string,
  Record<string, 'background' | 'focal_point' | 'foreground'>
> = {
  // Full screen templates
  full_image_slow_zoom_storytelling: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_slow_pan_left_storytelling: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_fast_zoom_emphasis: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_fast_turn_small: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_3d_perspective: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_add_gradient: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_film_shift: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_fast_camera_pan: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  full_image_add_vignettes: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  // One sentence one asset templates
  animated_title_1: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_title_2: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_title_3: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_title_5: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_title_6: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_title_7: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  // One word one asset templates
  animated_word_1: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_word_2: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_word_3: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_word_4: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  animated_word_5: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  // One desc one asset templates
  left_text_small_size_explain: {
    bg_1: 'background',
  },
  centered_text_emphasis: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  one_people_one_title_left: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  one_people_one_title_right: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  one_people_one_title_center: {
    bg_1: 'background',
    a_1: 'foreground',
  },
  // Two assets templates
  centred_one_sticker_popup_emphasis: {
    bg_1: 'background',
    a_1: 'focal_point',
  },
  small_object_large_people_explain: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  two_people_mention: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  vertical_two_assets: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  video_1_logo_1: {
    bg_1: 'background',
    a_1: 'foreground',
    a_2: 'focal_point',
  },
  centred_two_sticker_popup_compare: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  // Three assets templates
  shutter_transition: {
    a_1: 'foreground',
    a_2: 'foreground',
  },
  article_quote_1: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  article_quote_2: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  article_quote_3: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  twitter_quote: {
    bg_1: 'background',
    a_1: 'focal_point',
    a_2: 'focal_point',
  },
  // Info explainer templates
  centered_desc_growing_number: {
    bg_1: 'background',
  },
  centered_number_blur_background_data: {
    bg_1: 'background',
  },
  bar_chart_overlay_blur_background_data: {
    bg_1: 'background',
  },
  bar_chart_two_overlay_blur_background_data: {
    bg_1: 'background',
  },
  line_chart_overlay_up: {
    bg_1: 'background',
  },
  line_chart_overlay_down: {
    bg_1: 'background',
  },
  object_circle_zoom_emphasis: {
    bg_1: 'background',
  },
  // One title one desc templates
  title_desc_hand_write: {
    bg_1: 'background',
  },
  // Legacy templates
  fullscreen: {
    bg_1: 'background',
  },
}

// Asset type mapping: templateName -> assetId -> types
const ASSET_TYPE_MAP: Record<string, Record<string, TemplateAssetType[]>> = {
  // Most assets are images, but some can be both image and video
  full_image_fast_turn_small: {
    bg_1: ['image', 'video'],
    a_1: ['image', 'video'],
  },
  full_image_3d_perspective: {
    bg_1: ['image', 'video'],
    a_1: ['image', 'video'],
  },
  full_image_add_gradient: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
  },
  full_image_film_shift: {
    bg_1: ['image'],
    a_1: ['image', 'video'],
  },
  full_image_add_vignettes: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
  },
  animated_title_1: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
  },
  animated_title_2: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
  },
  animated_title_3: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
  },
  animated_title_4: {
    bg_1: ['image'],
    a_1: ['image', 'video'],
  },
  animated_title_6: {
    bg_1: ['image', 'video'],
    a_1: ['video', 'image'],
  },
  animated_title_7: {
    bg_1: ['image', 'video'],
    a_1: ['video', 'image'],
  },
  animated_word_1: {
    bg_1: ['image'],
    a_1: ['image', 'video'],
  },
  animated_word_2: {
    bg_1: ['image', 'video'],
    a_1: ['video', 'image'],
  },
  animated_word_3: {
    bg_1: ['image', 'video'],
    a_1: ['image', 'video'],
  },
  animated_word_4: {
    bg_1: ['image'],
    a_1: ['image', 'video'],
  },
  animated_word_5: {
    bg_1: ['image'],
    a_1: ['image', 'video'],
  },
  left_text_small_size_explain: {
    a_1: ['image', 'video'],
  },
  centered_text_emphasis: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
  },
  vertical_two_assets: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
    a_2: ['video', 'image'],
  },
  video_1_logo_1: {
    bg_1: ['image'],
    a_1: ['video', 'image'],
    a_2: ['image'],
  },
  centred_two_sticker_popup_compare: {
    bg_1: ['image', 'video'],
    a_1: ['image'],
    a_2: ['image'],
  },
  article_quote_1: {
    bg_1: ['image', 'video'],
    a_1: ['image'],
    a_2: ['image', 'video'],
  },
  article_quote_2: {
    bg_1: ['image', 'video'],
    a_1: ['image'],
    a_2: ['image', 'video'],
  },
  article_quote_3: {
    bg_1: ['image', 'video'],
    a_1: ['image'],
    a_2: ['image', 'video'],
  },
  twitter_quote: {
    bg_1: ['image', 'video'],
    a_1: ['image'],
    a_2: ['image'],
  },
  centered_desc_growing_number: {
    bg_1: ['image', 'video'],
  },
  centered_number_blur_background_data: {
    bg_1: ['image', 'video'],
  },
  bar_chart_overlay_blur_background_data: {
    bg_1: ['image', 'video'],
  },
  bar_chart_two_overlay_blur_background_data: {
    bg_1: ['image', 'video'],
  },
  line_chart_overlay_up: {
    bg_1: ['image', 'video'],
  },
  line_chart_overlay_down: {
    bg_1: ['image', 'video'],
  },
  object_circle_zoom_emphasis: {
    bg_1: ['image', 'video'],
  },
  // Default fallback is image only for all other assets
}

export const GROUP_NAME_DESC_MAP: Record<string, string> = {
  fullscreen_motion_effects:
    'High-energy, single-asset full-screen shots that rely on camera moves or 3-D flips to inject pace. Typical use-cases: (1) punch-in on a punch-line or awkward silence for comedy timing; (2) whip-pan to jump between two locations and keep momentum in vlogs or action edits; (3) slow cinematic push-in on an interview or object to build emotion or suspense; (4) fast rotate-and-shrink to park a teaser clip in a corner before switching to a talking-head; (5) adding subtle 3-D tilt to flat screen-captures in app demos.',
  fullscreen_stylized_overlays:
    'Visual polish layers applied on top of full-screen footage. Typical use-cases: (1) dark gradient bar to guarantee subtitle or title readability over busy footage; (2) cinematic letterbox bars to give a trailer or short film instant widescreen gravitas; (3) subtle or heavy vignettes to steer viewer focus toward the centre or to set a nostalgic / suspenseful mood; (4) applying the same gradient or vignette across mixed B-roll to create color unity.',
  animated_headline_titles:
    'Multi-line headline cards that own the screen. Typical use-cases: (1) hook viewers in the first three seconds of TikTok/Reels with a high-contrast title and slow-zoom bg; (2) chapter slides inside long video essays—wipe-in or glow to reset attention; (3) branded series openers that repeat the same motion language each episode; (4) data-storm number fields or neon frames to tee up tech / sci-fi topics; (5) dramatic quote or mission statement reveals for corporate intros.',
  word_fx_titles:
    'One-word or very short phrase animations designed as rhythm accents. Typical use-cases: (1) liquid-wobble lyric captions that pulse to lo-fi or EDM tracks; (2) glitch text to illustrate system errors, cyber-punk aesthetics or horror jump-cuts; (3) shock-wave wipes synced to beat drops in trailers; (4) slot-machine counters for giveaways, probability talks or countdown timers; (5) repeating text curtains to brand the very first shot of a social-media ad.',
  data_visualization_cards:
    'Glass-morphism widgets that animate numbers and charts directly over blurred backgrounds. **IMPORTANT**: Use when the original voice_over contains specific numbers, statistics, or quantitative data. The number, statistics, or quantitative data from assets should not be included as the value of the number. Typical use-cases: (1) count-up milestones for fundraising, subscriber or revenue celebrations; (2) single-bar progress to show KPI or goal completion in product updates; (3) two-bar A/B comparison for tech-review benchmarks or marketing test results; (4) line graph draw-on to visualise trends—stock price, climate data, user growth—inside documentaries or reports.',
  visual_callouts_annotations:
    'Visual annotations that call out specific elements of the screen. Typical use-cases: (1) adding a visual annotation to a static image to call out a specific element; (2) adding a visual annotation to a static image to call out a specific element; (3) adding a visual annotation to a static image to call out a specific element; (4) adding a visual annotation to a static image to call out a specific element; (5) adding a visual annotation to a static image to call out a specific element; (6) adding a visual annotation to a static image to call out a specific element.',
  cutout_subject_layouts:
    'Magazine-style compositions that mix cut-out people/objects with negative space and bold titles. Typical use-cases: (1) introduce interview guests or documentary characters with a clean poster look; (2) versus / matchup thumbnails—left vs right mirrored layouts; (3) hero-subject centre layout for YouTube thumbnail or cover art; (4) visionary-goal graphic: person at bottom, aspiration object above; (5) layered duo card to visualize rivals or partners; (6) split talk-head with B-roll panel for explainers; (7) framed screen-demo with persistent logo bumper in SaaS tutorials.',
  handwritten_whiteboard:
    'Real-time write-on animation that mimics marker strokes. Typical use-cases: (1) step-by-step math or science derivations for e-learning; (2) brainstorming mind-maps in creative workshops; (3) how-to lists where each bullet appears as it is explained; (4) behind-the-scenes story outlining or product roadmap unveilings.',
  social_media_pull_quotes:
    'Transforms real or fictional articles/tweets into full-screen cards. Typical use-cases: (1) cite a politician or expert tweet as evidence in commentary videos; (2) recreate a newspaper clipping to discuss historical events; (3) showcase customer praise in marketing reels; (4) pose a question to viewers by displaying a blank tweet and inviting replies.',
  basic_fullscreen:
    'Pure full-screen video playback without overlays; **REQUIRES video type assets**. Serves as breathable space when video footage alone carries the story—e.g., cinematic establishing shots, testimonial sound-bites, video montage sequences or palette cleansers between heavy graphics. This template is specifically designed for showcasing high-quality video content and should only be used when video assets are available.',
}
export const AVATAR_GROUP_NAME_DESC_MAP = {
  basic_avatar: 'An avatar video playback with images or videos overlay.',
}
export const HOOK_GROUP_NAME_DESC_MAP: Record<string, string> = {
  hook_fast_cut:
    "A rapid-fire sequence of short, high-energy clips that instantly grab viewers' attention and establish the video's pace, the most general hook type.",
  hook_match_cut:
    'A graphic match cut to maintain a consistent central object through a series of rapid edits, while the background or context changes with each cut to quickly build intrigue and present new information, suitable for video with clear and strong key concept or theme.',
  hook_layout_grid:
    'A multi-asset layout animation that arranges multiple images in a grid and applies various animation effects like zigcut, play, cluster, and more, suitable for showcasing multiple related concepts or products.',
  hook_slide:
    'A smooth slide transition video that presents a series of visual assets in a moderate pacing, enable clear showcase of each visual assets for medium length script that require real-world visual assets presentation.',
  hook_article_highlight:
    'A hook that highlights a key phrase from the script in an article, suitable for scripts which the topic is about news or require real-world websites or articles to be shown.',
}

export const TEMPLATE_LABELS = {
  ATOMIC_TEMPLATE: 'atomic_template',
  CODEGEN_TEMPLATE: 'codegen_template',
  HOOK_TEMPLATE: 'hook_template',
}

export const CORE_TEMPLATE_NAMES = ['fullscreen', 'avatar_fullscreen', 'avatar_static']

export function extractTemplatesGroupList(
  templates: RenderTemplate[],
  groupMap: Record<string, string>,
): TemplateGroup[] {
  const templatesGroupMap: Record<string, TemplateGroup> = {}

  for (const template of templates) {
    if (template.status !== 'Live') {
      continue
    }
    if (template.labels?.includes(TEMPLATE_LABELS.CODEGEN_TEMPLATE)) {
      continue
    }
    const groupName = template.category
    if (!groupName) {
      continue
    }
    const group = templatesGroupMap[groupName]
    if (group) {
      group.template_list.push(template.name)
    } else {
      templatesGroupMap[groupName] = {
        template_group_name: groupName,
        template_group_description: groupMap[groupName],
        template_list: [template.name],
      }
    }
  }
  return Object.values(templatesGroupMap).filter((group) => group.template_list.length > 0)
}
export function extractTemplatesMetadata(
  templates: RenderTemplate[],
): Record<string, TemplateMetadata> {
  const templatesMetadata: Record<string, TemplateMetadata> = {}

  for (const template of templates) {
    const assets: TemplateMetadata['assets'] = []

    // Process image placeholders only (text placeholders are not part of assets in TemplateMetadata)
    for (const placeholder of template.placeholders) {
      if (placeholder.type === 'image' || placeholder.type === 'background') {
        assets.push({
          description: placeholder.desc,
          id: placeholder.id,
          spec: {
            ratio: placeholder.ratio || 'any',
          },
          tools: ASSET_CUTOUT_TOOLS_MAP[template.name]?.[placeholder.id],
          type: ASSET_TYPE_MAP[template.name]?.[placeholder.id] || ['image'],
          useAs: ASSET_USE_AS_MAP[template.name]?.[placeholder.id] || 'foreground',
        })
      }
    }

    templatesMetadata[template.name] = {
      assets,
      backend: BACKEND_MAPPING[template.name] || 'omb',
      description: template.desc,
      useCase: template.useCases,
    }
  }

  return templatesMetadata
}
export function preprocessAvatarTemplates(templates: RenderTemplate[]) {
  fillBgPlaceholder(templates)
  for (let i = templates.length - 1; i >= 0; i--) {
    const template = templates[i]
    if (
      template.status !== 'Live' ||
      template.labels?.includes(TEMPLATE_LABELS.ATOMIC_TEMPLATE) ||
      template.labels?.includes(TEMPLATE_LABELS.HOOK_TEMPLATE) ||
      template.category !== 'basic_avatar'
    ) {
      templates.splice(i, 1)
    }
  }
}
export function preprocessTemplates(templates: RenderTemplate[]) {
  fillBgPlaceholder(templates)
  for (let i = templates.length - 1; i >= 0; i--) {
    const template = templates[i]
    if (
      template.status !== 'Live' ||
      template.labels?.includes(TEMPLATE_LABELS.ATOMIC_TEMPLATE) ||
      template.labels?.includes(TEMPLATE_LABELS.HOOK_TEMPLATE) ||
      template.category === 'basic_avatar'
    ) {
      templates.splice(i, 1)
    }
  }
}
function fillBgPlaceholder(templates: RenderTemplate[]) {
  for (const template of templates) {
    if (!template.placeholders) {
      continue
    }
    if (template.placeholders.some((p) => p.type === 'background')) {
      continue
    }
    if (template.name === 'fullscreen') {
      template.placeholders.unshift({
        type: 'background',
        desc: 'A full-screen image or video which could best describe the shot description',
        id: 'bg_1',
        ratio: '9:16',
      } as RenderTemplateBgPlaceholder)
    } else {
      template.placeholders.unshift({
        type: 'background',
        desc: 'A full-screen image background, but it will always be covered by the foreground image, almost useless.',
        id: 'bg_1',
        ratio: '9:16',
      } as RenderTemplateBgPlaceholder)
    }
  }
}
