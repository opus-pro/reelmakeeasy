import {
  buildLongTakeRoutedPromptTemplate,
  type LongTakePromptRoute,
} from '../../long-take-prompt-router'
import { LONG_TAKE_ASSET_MANAGER_LAYOUT_BLOCK } from '../long-take-experts-analysis'

interface AssetManagerPromptParams {
  assetManifestJson: string
  promptRoute?: LongTakePromptRoute
  styleText?: string
}

export function buildLongTakeAssetManagerExpertPrompt(params: AssetManagerPromptParams): string {
  const assetManifestJson = params.assetManifestJson?.trim() || '{"asset_manifest":[]}'
  const { styleText } = params

  const isStyled = !!styleText?.trim()

  const styleConstraint = isStyled
    ? `Crucial Constraint:
You must generate every asset in the following artistic style: "${styleText}".
Adapt character/prop descriptions to be appropriate for this style — for example, a stick-figure style should NOT describe detailed facial features or realistic wardrobe textures. Focus on the essential identifying traits (silhouette, key props, color) that matter for the style.`
    : `Crucial Constraint:
You must IGNORE the artistic style found in the World Bible. You must generate every asset as Photorealistic / Live Action. These are "Ground Truth" assets for structural reference.`

  const headerInstructions = isStyled
    ? `1. The "Subject Inventory" (The Header)
Construct the prompt header based on the Asset Type. Adapt the description complexity to match the artistic style.
User Asset Protocol: If tagged source: "USER_FILE", use the provided visual_reference as the design truth. You MUST preserve and explicitly include ALL observable appearance details from the visual_reference: exact clothing (color, style, patterns), hairstyle (color, length, style), skin tone, accessories, held objects, and footwear. Do NOT omit or generalize any of these details.
Multi-Angle Asset (is_multi_angle: true — Character or Prop): Override the default templates below. Use: "A single reference image of [Name/Object], [Key identifying traits from visual_reference], [Exact wardrobe/details from visual_reference]. ${styleText}." The header MUST NOT contain the words "sheet", "grid", "panels", "views", or "multi-view".
Canonical Singer Asset (asset_id: "char_singer"): Override the default character template below. Use: "A single reference image of [Name], [Key identifying traits from visual_reference], [Exact clothing/hair from visual_reference]. ${styleText}." The header MUST NOT contain the words "sheet", "grid", "panels", "views", or "multi-view".
Characters (non multi-angle): "A character reference sheet of [Name], [Key identifying traits only — silhouette, distinguishing props, color palette], wearing [Exact Clothing from visual_reference], [Exact Hair/Face details from visual_reference]. ${styleText}."
Props (non multi-angle): "A prop reference sheet of [Object], [Key visual traits]. ${styleText}."`
    : `1. The "Subject Inventory" (The Header)
Construct the prompt header based on the Asset Type.
User Asset Protocol: If tagged source: "USER_FILE", use the provided visual_reference as the design truth, but upgrade the rendering to Studio Quality (The "Car Wash" effect). You MUST preserve and explicitly include ALL observable appearance details from the visual_reference: exact clothing (color, style, patterns), hairstyle (color, length, style), skin tone, accessories, held objects, and footwear. Do NOT omit or generalize these as "standard attire" or similar placeholders.
Multi-Angle Asset (is_multi_angle: true — Character or Prop): Override the default templates below. Use: "A single high-fidelity studio reference image of [Name/Object], [Age & Body Type or Visual Reference], [Exact wardrobe/details from visual_reference]. Neutral grey background, studio lighting." The header MUST NOT contain the words "sheet", "grid", "panels", "views", or "multi-view".
Canonical Singer Asset (asset_id: "char_singer"): Override the default character template below. Use: "A single high-fidelity studio reference image of [Name], [Age & Body Type or Visual Reference], [Exact clothing/hair from visual_reference]. Neutral grey background, studio lighting." The header MUST NOT contain the words "sheet", "grid", "panels", "views", or "multi-view".
Characters (non multi-angle): "A studio reference grid of [Name], [Age & Body Type], wearing [Exact Wardrobe & Accessories from visual_reference]. [Exact Face/Hair details from visual_reference]. Neutral grey background, studio lighting."
Props (non multi-angle): "A studio reference grid of [Object], [Visual Reference]. Isolated on neutral grey background, studio lighting."`

  const shotListInstructions = isStyled
    ? `2. The Dynamic Shot List (The Body)
Routing: Apply these shot lists based on multi-angle status first, then asset type.
IF is_multi_angle: true (Multi-Angle Asset — Character or Prop):
Do NOT generate a multi-view grid. This asset represents a single specific view of a multi-angle set.
Generate a single hero shot that preserves the source image's camera angle and perspective.
shot_list should contain only one entry describing the specific angle view.
IF asset_id is "char_singer":
Do NOT generate a multi-view grid. Generate exactly one clean singer reference image.
shot_list should contain only one entry: "a front 3/4 full-body singer reference view."
IF CHARACTER (non multi-angle):
You must construct a comma-separated list of 4 views using lowercase phrasing.
Required Sequence: "containing views of: a front full-body view, a side profile view, a 3/4 view, and a back view."
IF PROP (non multi-angle, including single-image USER_FILE and non-USER_FILE):
You must construct a comma-separated list of 4 views using lowercase phrasing.
Required Sequence: "containing views of: a front view, a side view, a top-down view, and a detail view."`
    : `2. The Dynamic Shot List (The Body)
Routing: Apply these shot lists based on multi-angle status first, then asset type.
IF is_multi_angle: true (Multi-Angle Asset — Character or Prop):
Do NOT generate a multi-view grid. This asset represents a single specific view of a multi-angle set.
Generate a single hero shot that preserves the source image's camera angle and perspective.
shot_list should contain only one entry describing the specific angle view.
IF asset_id is "char_singer":
Do NOT generate a multi-view grid. Generate exactly one clean singer reference image.
shot_list should contain only one entry: "a front 3/4 full-body singer reference view."
IF CHARACTER (non multi-angle):
You must construct a comma-separated list of 6 angles using lowercase phrasing.
Required Sequence: "containing views of: a hero headshot, a high-angle 3/4 portrait, a low-angle full body shot, a side profile view, an off-axis reaction shot, and a front orthographic face detail shot."
IF PROP (non multi-angle, including single-image USER_FILE and non-USER_FILE):
You must construct a comma-separated list of 6 angles using lowercase phrasing.
Required Sequence: "containing views of: a hero product shot, a front elevation view, a side profile view, a top-down view, an isometric view, and a detailed close-up."`

  const styledLayoutBlock =
    'Composition: A seamless 2x2 image grid containing exactly 4 panels. Layout: 2 Columns, 2 Rows. Visual Continuity: Subject must be recognizable across all panels. Zero padding, zero gutters, no white space, contiguous image. no text, no labels, no typography, no watermarks. --ar 1:1'

  const layoutInstructions = isStyled
    ? `3. The Layout Engine (The Footer)
IF is_multi_angle: true (Character or Prop):
Use this footer instead: "Composition: A single, solitary image of the subject in one continuous frame. Match the aspect ratio and perspective of the source image. STRICT NEGATIVE CONSTRAINTS: do NOT render a grid, collage, panel layout, split view, multi-view sheet, reference sheet, contact sheet, storyboard, diptych, triptych, or any composition containing multiple poses, angles, or sub-images. Exactly one image of the subject, nothing else."
IF asset_id is "char_singer":
Use this footer instead: "Composition: A single, solitary image of the subject in one continuous frame. STRICT NEGATIVE CONSTRAINTS: do NOT render a grid, collage, panel layout, split view, multi-view sheet, reference sheet, contact sheet, storyboard, diptych, triptych, or any composition containing multiple poses, angles, or sub-images. Exactly one image of the subject, nothing else. --ar 2:3"
ALL OTHER ASSETS (single-image Characters and Props):
You MUST append this exact technical block to lock the grid structure:
Block: "${styledLayoutBlock}"`
    : `3. The Layout Engine (The Footer)
IF is_multi_angle: true (Character or Prop):
Use this footer instead: "Composition: A single, solitary, high-fidelity image of the subject in one continuous frame. Match the aspect ratio and perspective of the source image. High-Fidelity, 8k. STRICT NEGATIVE CONSTRAINTS: do NOT render a grid, collage, panel layout, split view, multi-view sheet, reference sheet, contact sheet, storyboard, diptych, triptych, or any composition containing multiple poses, angles, or sub-images. Exactly one image of the subject, nothing else."
IF asset_id is "char_singer":
Use this footer instead: "Composition: A single, solitary, high-fidelity image of the subject in one continuous frame. Neutral grey background, studio lighting. STRICT NEGATIVE CONSTRAINTS: do NOT render a grid, collage, panel layout, split view, multi-view sheet, reference sheet, contact sheet, storyboard, diptych, triptych, or any composition containing multiple poses, angles, or sub-images. Exactly one image of the subject, nothing else. --ar 2:3"
ALL OTHER ASSETS (single-image Characters and Props):
You MUST append this exact technical block to lock the grid structure:
Block: "${LONG_TAKE_ASSET_MANAGER_LAYOUT_BLOCK}"`

  const generalPrompt = `Role: Expert Asset Manager and Prompt Engineer.

Input: asset_manifest.json (From Line Producer).
Objective: Transform text descriptions into Anchor Asset Prompts for Characters and Props.

${styleConstraint}

Logic Rules (The Asset Architecture)

${headerInstructions}

${shotListInstructions}

${layoutInstructions}

Output schema:
{
  "prompts": [
    {
      "asset_id": "char_runner",
      "type": "Character|Prop",
      "source": "USER_FILE|null",
      "header": "string",
      "shot_list": ["string"],
      "layout_block": "${isStyled ? styledLayoutBlock : LONG_TAKE_ASSET_MANAGER_LAYOUT_BLOCK}",
      "prompt_text": "string"
    }
  ]
}

asset_manifest.json:
${assetManifestJson}`

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute: params.promptRoute,
    templateName: 'asset-manager',
  })
}
