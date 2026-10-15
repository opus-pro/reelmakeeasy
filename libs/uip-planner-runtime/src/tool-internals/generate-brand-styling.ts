/**
 * UIP brand-styling helper -- one LLM call at bootstrap_script entry that
 * synthesizes a universal Style + Re-Skin paragraph pair from the locked
 * `brand_bank` and the user's selected style preset. The caller
 * (`runGenerateIntentContextTool`) overwrites `style.style_text` with
 * `${brand_style_paragraph}\n${medium_reskin_paragraph}`; the downstream
 * long-take `Stylize the image with ${styleText}` pathway consumes the
 * universal block unchanged.
 *
 * Failure model: retry once. On final failure return `null` and the caller
 * leaves `style.style_text` as the user's preset -- brand color absence is
 * a degraded experience, not a broken one.
 *
 * `SYNTHESIS_INSTRUCTION` is a port of Sections 1 + 2 of a designer-authored
 * brand-style extraction guide, with the adaptations listed at the
 * constant's docblock. Changes to it need an explicit edit + diff review.
 */

import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { z } from 'zod'

import { PLANNER_TOOL_MODELS_LIGHT } from '../model-config'
import type { BrandBank } from '../types'

const logger = createSubLogger('uip-planner-runtime:generate-brand-styling')

const BrandStylingOutputSchema = z.object({
  brand_style_paragraph: z.string().min(1),
  medium_reskin_paragraph: z.string().min(1),
})

export type BrandStylingOutput = z.infer<typeof BrandStylingOutputSchema>

export interface GenerateBrandStylingOptions {
  brandBank: BrandBank
  userStyleText: string
}

export async function generateBrandStyling(
  opts: GenerateBrandStylingOptions,
): Promise<BrandStylingOutput | null> {
  const prompt = buildBrandStylingPrompt(opts)
  const startedAt = Date.now()
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await completion({
        models: PLANNER_TOOL_MODELS_LIGHT,
        prompt,
        responseFormat: BrandStylingOutputSchema,
        reasoningEffort: 'low',
        task: 'user-intent-planner-generate-brand-styling',
        temperature: 0.4,
        timeout: 30_000,
        enableSearch: false,
      })
      logger.info(`[uip-brand-styling] ok durationMs=${Date.now() - startedAt} attempt=${attempt}`)
      return result
    } catch (err) {
      logger.warn(
        `[uip-brand-styling] attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return null
}

// Tier 3 redaction at the input boundary. Same discipline as
// `redactBrandBankForStructuredBrief` in brand-prompt-facts.ts.
// The Style Paragraph is brand-pure visuals, not narrative -- the LLM
// must not see persona / signature_phrases / vision_and_values /
// target_audience / pain_points / founders / product_offerings /
// testimonials / origin_quotes even passively. `palette` IS kept --
// it's the whole point of brand styling.
export function buildBrandStylingPrompt(opts: GenerateBrandStylingOptions): string {
  return `${SYNTHESIS_INSTRUCTION}

BRAND DNA:
${JSON.stringify(toBrandDnaInput(opts.brandBank), null, 2)}

USER STYLE PRESET (medium anchor for the Re-Skin Paragraph):
${opts.userStyleText || '(no preset selected; use neutral cinematic rendering)'}`
}

export function toBrandDnaInput(bank: BrandBank): unknown {
  return {
    business_name: bank.basic_info.business_name,
    about_us_summary: bank.basic_info.about_us_summary,
    location: bank.basic_info.location,
    palette: bank.palette,
  }
}

/**
 * Port of the brand-style extraction guide's Section 1 + Section 2 with
 * these adaptations:
 *   - DROP: BRAND CHECKLIST output section (not used here).
 *   - DROP: STORY BLUEPRINT output section (not used here).
 *   - REWRITE: RE-SKIN PARAGRAPH instruction switched from "CHOOSE A
 *     RE-SKIN FROM THE CATALOG" (a human-in-the-loop step in the source
 *     guide) to "the user's preset is the medium anchor; study the
 *     exemplars to understand the structural rhythm, then write a fresh
 *     paragraph for the preset (or fall back to Writing-Your-Own)."
 *   - REWRITE: output format from labeled plain-text sections to
 *     structured JSON ({ brand_style_paragraph, medium_reskin_paragraph }).
 *   - DROP: the worked example (Section 3 of the source guide) --
 *     example only, not needed in the prompt.
 *   - ADD: a RE-SKIN EXEMPLARS section combining 3 catalog templates
 *     (Claymation / 3D Animated Pixar-Adjacent / Mixed-Media Collage) with
 *     6 additional samplers (Tactile Clay World, Photomontage, Phygital Pop,
 *     Energetic Mixed-Media Collage, Contour Sketch Minimalism, Editorial
 *     Vector). These are SAMPLERS, not a lookup
 *     table -- the LLM should not name-match the user's preset to an
 *     exemplar; the preset is treated as a free-form medium label and
 *     the exemplars teach the structural register of a good Re-Skin
 *     paragraph. The previous KNOWN UIP STYLE PRESETS hardcoded list
 *     was dropped (the FE preset library is the single source of truth;
 *     duplicated config rots).
 */
const SYNTHESIS_INSTRUCTION = `Role:
You are an expert Visual Semiotician and Brand Strategist. Your task is to analyze a Branding DNA block (and optional style reference images) and extract a brand style that can be applied to any image through a text prompt.

You will produce two paragraphs as structured JSON output (schema described at the end of this instruction).

---

WHAT TO EXTRACT

Analyze the Branding DNA across these five visual dimensions:

1. Color Palette with Dominance Weights
   Extract every hex value from the Branding DNA. Classify each as: hero color (headlines, CTAs — highest visual weight), supporting color (accents, secondary elements), ground color (backgrounds, negative space), or text color (body, captions). Assign approximate dominance percentages based on their role descriptions.

2. Texture Behavior
   Infer from the brand's voice, aesthetic context, and any reference imagery. Map the brand's personality to a texture vocabulary:
   - Warm/authentic/heritage/western brands: visible grain, linen or paper substrate, natural fiber texture, matte surfaces, weathered wood or leather tactility
   - Clean/modern/tech brands: smooth matte or glossy surfaces, minimal texture, precise edges, glass or metal materiality
   - Playful/creative brands: mixed textures, visible brushwork or hand-drawn quality, tactile paper or fabric
   - Premium/luxury brands: subtle grain, silk or velvet texture, deep matte blacks, metallic accents

3. Contrast Dynamics
   Derive from the palette structure: what is the value range between the darkest and lightest colors? How does the brand separate foreground from background? Is the contrast high (bold, energetic) or low (soft, approachable)? How do accent colors punctuate the ground?

4. Shape Language
   Infer from brand voice and visual identity together:
   - Warm/family/organic brands: rounded forms, soft curves, natural silhouettes, generous proportions
   - Corporate/precision brands: geometric forms, sharp angles, structured grids, uniform proportions
   - Artisanal/craft brands: hand-drawn irregularity, organic asymmetry, imperfect edges
   - Premium brands: refined curves, balanced proportions, deliberate negative space

5. Lighting Mood
   Infer from brand tone and color temperature:
   - Authentic/warm brands: golden diffused illumination, soft directional light suggesting late afternoon or fireside, warm shadows
   - Clean/modern brands: even high-key illumination, neutral daylight, minimal shadow
   - Dramatic/bold brands: directional key light with visible shadow, high contrast between lit and unlit areas
   - Intimate/premium brands: soft low-key illumination, controlled pools of warm light, rich shadow depth

---

ANTI-POLLUTION RULES

The Style Paragraph must describe HOW things look, never WHAT is depicted:
- Describe the visual execution independent of any objects or subjects
- Do not mention brand-specific nouns, product names, or character descriptions
- Do not include compositional layouts (no "centered," "rule of thirds," "foreground/background")
- Translate any typography into pure visual texture — but be careful: even the translated form can trigger unwanted text in the generated image if it uses words associated with writing. Words like "letterform," "legible," "typographic," "glyph," "titling," and "caption" all activate text generation in image models. Instead, describe the visual properties using pure shape and line language: "bold geometric sans-serif titling" becomes "clean angular structural line work with heavy uniform stroke weight." "Crisp, legible detailing" becomes "crisp, precise detailing." The goal is to capture the weight, geometry, and rhythm of the brand's typography without any word that could be interpreted as "put text in the image."
- Test: "Could I apply this paragraph to a scene of astronauts on Mars and still get a coherent visual?" If not, the paragraph is polluted with brand-specific content. Remove it.
- Second test: "Does any phrase in this paragraph contain a word associated with text, writing, letters, or reading?" If yes, replace it with a pure shape/line/weight descriptor. Image models treat text-associated words as instructions to render visible text.

---

STYLE PARAGRAPH GUIDANCE

Write a single dense paragraph, 80-150 words. This paragraph describes the brand's pure visual execution: color relationships, texture behavior, contrast dynamics, shape language, and lighting mood. Every phrase must be a transferable visual instruction that works on any subject. Start with an aesthetic heritage anchor if one is identifiable (e.g., "Western heritage ranch tradition" or "Scandinavian minimalist design lineage"). The heritage anchor must evoke a visual tradition, not an abstract concept. "Western heritage ranch tradition" works because it calls up a recognizable visual world. "Modern authoritative service design" fails because the image model may render abstract concepts as literal text stamped onto surfaces in the scene. If the brand's lineage is conceptual rather than visual, translate it into its closest visual tradition — e.g., "Swiss International Style precision" rather than "Modern authoritative service design," or "warm pastoral Americana" rather than "family-oriented authentic brand." This paragraph will be pasted directly into image generation prompts, so write it as a style directive, not a description or analysis.

---

RE-SKIN PARAGRAPH GUIDANCE

Produce a single paragraph rendering the brand palette through the user-selected medium. The user's preset (provided as USER STYLE PRESET below) is the medium anchor. The preset can be any string -- it is not constrained to a fixed list. Treat the preset name as the canonical medium label and infer the medium's visual language from the name.

The Re-Skin Exemplars below are SAMPLERS, not a hardcoded lookup table. Do not match the user's preset to an exemplar by name. Instead, study the exemplars to understand the structural rhythm of a high-quality Re-Skin paragraph -- material system, palette mapping, lighting handling, edge / shape discipline, constraints clause -- and write a fresh paragraph in the same register for the user's preset. If the preset is similar in spirit to an exemplar, you may borrow phrasing; otherwise generalize via the Writing-Your-Own pattern.

Infer ONLY the medium's capture / rendering aesthetic from the preset name -- never a subject, theme, or domain. A capture-style preset such as \`UGC\` maps to casual handheld framing, natural available light, and authentic phone-shot composition and grain; it does NOT license inventing what is filmed (no culinary / food / nature / lifestyle theme). Never introduce subject matter that is not grounded in the BRAND DNA or the literal preset name.

---

RE-SKIN ANTI-POLLUTION RULES

The Re-Skin Paragraph obeys the same discipline as the Style Paragraph: describe HOW the medium and the brand palette look, never WHAT is depicted.
- Express the medium and the brand palette only as visual treatment -- color, material, finish, surface, texture, tone, lighting, shape language, depth. Never instantiate a color or the medium as a recurring literal subject or object (no food, produce, ingredients, props, characters, scenery, or environments). Concretely: "orange" maps to "saturated orange accent fills, surface pigment, or a warm color grade," never to orange objects.
- Test: "Could I apply this paragraph to a scene of astronauts on Mars and still get a coherent visual?" If not, the paragraph names or implies a subject domain and is polluted. Remove it.

---

RE-SKIN EXEMPLARS (samplers, not a lookup table)

### Tactile Clay World

Render as a highly tactile 3D miniature diorama with matte, light-absorbing materials such as polymer clay, soft plastic, felt, and smooth painted wood carrying the brand's color palette, chunky rounded geometry with universally beveled edges and toy-like proportions preserving the brand's shape language, soft global illumination with warm diffuse key light and gentle ambient fill maintaining, shallow macro depth-of-field with tilt-shift characteristics emphasizing miniature scale through selective focus falloff, subtle high-frequency tactile grain and micro-imperfections embedded across all surfaces simulating handcrafted material texture, pronounced ambient occlusion and soft luminous shadowing reinforcing physical proximity between forms, and controlled warm color grading ensuring the brand's palette remains cohesive within the matte material system, in the lineage of stop-motion miniature sets and handcrafted diorama worlds. All elements must resolve within a unified matte, handcrafted material system with no glossy reflections, sharp edges, outlines, or hyper-realistic surface detail breaking the miniature illusion.

### Photomontage

Render as a retro-modern digital photomontage collage combining high-contrast grayscale photographic cutouts with flat, vividly colored vector geometric shapes carrying the brand's color palette as solid unshaded fills, sharp die-cut edges on all photographic elements with no blending preserving crisp layer separation, strict dual-domain material system where photographic elements remain entirely black-and-white while graphic elements remain fully saturated in bold flat color, sparse off-white paper background with subtle grain providing negative space, non-unified lighting where photographic elements retain their original internal contrast while graphic shapes remain unshaded, layered planar composition with floating elements and deliberate scale discontinuity, and controlled high-contrast balance ensuring clarity between grayscale imagery and bold geometric overlays, in the lineage of Dadaist photomontage and Constructivist graphic design. All elements must resolve within this dual-material collage logic with no gradients, colorization, soft transitions, depth-of-field blur, or unified lighting breaking the separation between photographic and graphic layers.

### Phygital Pop

Render as a phygital mixed-media composition combining high-resolution photorealistic subjects with chunky 3D voxel objects carrying the brand's color palette across both physical and digital elements, rigid cubic voxel geometry with visible block structure contrasting against smooth organic realism preserving clear material distinction, crisp unified studio lighting with clean directional key and soft shadowing grounding all elements within a shared physical space, minimal flat studio background with bold contrasting color providing visual isolation and clarity, sharp edge fidelity between photoreal and voxel elements with no blending or transitional smoothing, consistent scale and spatial interaction ensuring voxel objects occupy tangible volume rather than appearing as overlays, and saturated high-contrast color balance maintaining a playful retro-futuristic intensity in the lineage of Y2K digital aesthetics and voxel-based 3D systems. All elements must resolve within this dual-material system with physically coherent lighting, with no soft blending between domains, no 2D pixel rendering, and no complex or realistic environments breaking the clean studio isolation.

### Energetic Mixed-Media Collage

Render as a mixed-media pop-art composition combining high-contrast grayscale photographic faces and skin with vibrant flat illustrated overlays carrying the brand's color palette as saturated, unshaded graphic fills, strict separation where all human skin and facial features remain entirely black-and-white photographic while clothing and surrounding elements are replaced or overlaid with bold abstract shapes, thick marker-like contour lines, and graphic patterning, energetic Memphis-inspired visual language with organic blobs, wavy strokes, and mixed line textures preserving strong graphic contrast, minimal light or white background acting as a clean canvas populated with floating doodle elements, no lighting or shading applied to illustrated components while photographic elements retain natural contrast, and high-intensity color balance ensuring sharp distinction between photoreal realism and flat graphic abstraction, in the lineage of retro pop-art collage and Memphis design systems. All elements must resolve within this dual-layer system with no color applied to photographic skin, no gradients or dimensional lighting on graphic elements, and no realistic environments or soft blending breaking the separation between photographic and illustrated domains.

### Contour Sketch Minimalism

Render as a highly reductive monochrome ink-sketch system using pure black linework and solid fills on a pure white background, with all forms constructed through thick, uniform, slightly wobbly contours carrying the brand's structure through casual hand-drawn rhythm rather than polished precision, strict binary color logic where black is used only for outlines, localized block fills, and minimal graphic accents while white remains empty negative space, intentionally broken contour construction with frequent open gaps at joints and edges allowing forms to resolve through implied closure, simplified organic shapes and slightly exaggerated proportions preserving immediate readability and relaxed gestural character, strategic use of one or two solid black fill zones anchoring the composition, and flat unshaded visual balance ensuring stark contrast and minimalist clarity in the lineage of spontaneous marker sketch illustration. All elements must resolve within this broken-contour ink system with no grayscale, gradients, hatching, realistic environments, or fully sealed vector-clean outlines breaking the hand-drawn openness of the style.

### Editorial Vector

Render as a modern flat vector editorial illustration using clean, outline-free color blocking with overlapping geometric planes carrying the brand's color palette as soft pastel bases and saturated mid-tone accents, fluid exaggerated human proportions with elongated limbs and simplified or absent facial features preserving universal abstraction, strict separation of forms through color contrast rather than linework, selective application of fine digital stipple or grain gradients along edges of large shapes introducing subtle depth without volumetric lighting, flat spatial construction with layered abstract backgrounds composed of arches, steps, and planar forms, minimal shadow treatment using simple flat geometric shapes rather than realistic lighting, and controlled color balance ensuring a warm, cohesive, and highly legible visual system in the lineage of contemporary corporate editorial vector illustration. All elements must resolve within this flat vector system with no global outlines, no realistic textures or materials, no 3D lighting or specular highlights, and no detailed facial features breaking the simplified geometric abstraction.

### Claymation

Render as handcrafted stop-motion claymation with visible fingerprint impressions and tool marks on all clay surfaces, the brand's color palette mixed into matte polymer clay with slight color variation between sculpted pieces, miniature-scale set construction with slightly oversized surface textures and exaggerated material grain that reveal the handmade miniature scale, soft directional key light with gentle shadows preserving the brand's warm-to-cool temperature ratio, shallow depth-of-field with slight bokeh on background set pieces, faintly visible seam lines where clay pieces join together reinforcing the handbuilt construction, and tactile imperfection throughout — no surface is perfectly smooth, no edge is perfectly straight.

### 3D Animated Pixar-Adjacent

Render as dimensional 3D animation with soft subsurface-scattering materials that carry the brand's color palette as surface pigment, rounded appealing character proportions with subtle stylization, soft global illumination with warm key light and cool ambient fill preserving the brand's lighting temperature, shallow cinematic depth-of-field separating focal subjects from softly defocused environments, matte material surfaces with the brand's texture grain embedded as subtle bump-map displacement, clean volumetric atmosphere with gentle light scattering, and richly saturated color depth in all material surfaces ensuring the brand's palette reads with full vibrancy under the 3D lighting.

### Mixed-Media Collage

Render as a restrained mixed-media composition with two asymmetric photographic focal subjects placed against a quiet hand-painted color-field background, visible paper substrate with subtle linen or kraft texture, the brand's color palette applied as spare flat color fields on the painted layer while the photographic elements retain their natural color within the brand's temperature range, clean scissor-cut edges with a slight white paper margin around the photographs, generous negative space surrounding the focal subjects, a single soft drop shadow establishing each photograph's separation from the painted ground, smooth matte painted surfaces with deliberate color discipline, and an overall refined modernist paper-cutout tradition reminiscent of Matisse's spare compositional clarity.

---

WRITING-YOUR-OWN PATTERN

For any user preset, you can fall back to this fillable template if no exemplar fits the medium spirit:

Render as [your medium] with [the medium's signature surface or material treatment] carrying the brand's color palette as [the color / material treatment the colors take in this medium -- fills, pigment, grade, tint], never as literal objects, [the medium's characteristic shape and proportion style] preserving the brand's shape language, [the medium's lighting approach] maintaining the brand's temperature ratio, [the medium's texture signature] layered over the brand's base texture, [the medium's depth and spatial treatment], and [the medium's characteristic imperfection or motion quality]. Close with a one-sentence constraints clause naming the things that must NOT appear (matching the discipline shown in the exemplars).

---

OUTPUT FORMAT

Return ONLY structured JSON conforming to this schema. Do NOT use plain-text section headers. Do NOT include a BRAND CHECKLIST or STORY BLUEPRINT.

{
  "brand_style_paragraph": "<80-150 word Style Paragraph per the guidance above>",
  "medium_reskin_paragraph": "<single Re-Skin paragraph per the guidance above>"
}

Both strings must be non-empty.`
