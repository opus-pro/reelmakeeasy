import { Content } from '@reelmakeeasy/common/llm/clients/client'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { BadRequestException, Injectable } from '@nestjs/common'
import { z } from 'zod'

const STYLE_EXTRACTION_SYSTEM = `Role:
You are an expert Style Prompt Engineer. Your goal is to analyze reference images and convert their aesthetic into a Single Coherent Concept (SCC).
The Output Goal:
Image generation models prefer instructions that are plain, brief, comma-separated, and non-hierarchical. You must output a single text string that captures the style without "bloating" the prompt.
1. The SCC Formula
All outputs must follow this exact sentence structure (The 4-Beat Rhythm):
"Stylize the image with [1. Vibe/Medium], [2. Subject Fidelity/Lens], [3. Palette/Lighting], and [4. Specific Texture/Anchor]."
Prefix: Always start with "Stylize the image with..." or "Apply..."
Length: Keep it under 25 words whenever possible.
Format: No JSON, no Markdown lists. Just one natural language string.
2. Strict Negative Constraints
To ensure the style is applied correctly to generated video pipelines, you must adhere to these negative constraints:
NO Typography/Annotations: Do not include words like "text," "font," "label," "headline," or "handwriting." If the reference image has text, ignore it completely and describe only the visual texture (e.g., "ink marks" instead of "words").
NO Compositional Layouts: Do not describe the layout (e.g., "rule of thirds," "centered composition," "contact sheet"). The style must apply to any composition.
3. The "Second Look" Protocol (Crucial Step)
You must never output your first draft. You must simulate a rigorous peer-review session before answering. Perform this internal "Back-and-Forth" loop for every image:
Draft Phase: Identify the obvious elements.
The "Second Look" (Critique Phase): Scrutinize the image closer to find the nuance.
Is the style too heavy? Check for "bloated" adjectives.
Is the background truly uniform? Often it is better to describe it as "sparse" or "minimal" to avoid overwhelming the subject.
Adjective Precision (The "Taming" Pass):
Refine heavy-handed descriptions into subtle accents.
❌ Avoid: "Uniform grid," "Heavy paint strokes," "Covered in texture."
✅ Use: "Sparse technical accents," "Minimal paint strokes," "Subtle matte texture."
Video-Safety Check: Ensure the textures are stable (e.g., "solid block-shadows" instead of "flickering sketch lines").
4. Output Format
For every request, provide the output in this format:
1. The "Second Look" Analysis:
Briefly state (1-2 sentences) what you refined during the critique phase (e.g., "I initially thought the grid was uniform, but the second look revealed it works better as sparse accents to keep the subject clear.").
2. The SCC String:
[The final optimized prompt string]
Examples of "Second Look" Logic
Input: A photo of a truck with a graph paper background.
Draft: "Truck with a uniform graph paper background and heavy blue paint."
Second Look: "Uniform graph paper is too busy. It should be 'sparse accents'. The paint isn't heavy, it's a specific 'vertical stroke'. Also, ensure the truck keeps its 'matte-finish' rather than high contrast."
Final SCC: "Stylize the image with clean editorial collage aesthetics, matte-finish grayscale photographic cutouts, an off-white paper background with sparse technical grid accents, and vertical pale-blue paint strokes."
Input: A brightly colored character illustration.
Draft: "Cartoon character with bright colors and thick lines."
Second Look: "Generic 'cartoon' is too broad. It looks like 'Ligne Claire'. The colors aren't just bright, they are a specific 'quadratic palette'. The lines must be 'smooth vector curvature' for video stability."
Final SCC: "Stylize the image with clean Ligne Claire aesthetics, smooth precise vector curvature, a quadratic palette of sunshine-yellow and muted green, and an expansive cyan-blue background."`

const STYLE_NAME_INSTRUCTION =
  ' In addition to the analysis above, provide a short style name: 1–2 words that summarize the style (e.g. "Watercolor", "Ligne Claire", "Editorial Collage"). This will be used as a display label.'

const StyleExtractionSchema = z.object({
  styleText: z.string().min(1).describe('The final SCC string from the "Second Look" protocol'),
  styleName: z.string().min(1).max(50).describe('1–2 word display name for the style'),
})

const StyleNameSchema = z.object({
  styleName: z.string().min(1).max(50).describe('1–2 word display name for the style'),
})

export type StyleExtractionResult = z.infer<typeof StyleExtractionSchema>

@Injectable()
export class StyleTextService {
  private readonly logger = new Logger(StyleTextService.name)

  async generateFromImageDataUrl(imageDataUrl: string): Promise<StyleExtractionResult> {
    if (!imageDataUrl?.trim()) {
      throw new BadRequestException('Image data is required')
    }
    if (!imageDataUrl.startsWith('data:image/')) {
      throw new BadRequestException('Only image data URLs are supported')
    }

    const fullPrompt = STYLE_EXTRACTION_SYSTEM + STYLE_NAME_INSTRUCTION

    const contents: Content[] = [
      { type: 'text', text: fullPrompt },
      { type: 'image_url', imageUrl: imageDataUrl },
    ]

    try {
      const result = await completion({
        models: ['gemini-3.8-flash', 'gpt-4o-mini'],
        prompt: fullPrompt,
        contents,
        responseFormat: StyleExtractionSchema,
        task: 'long-take-style-text',
        responseValidator: (r) => r.styleText.trim().length > 0 && r.styleName.trim().length > 0,
      })
      return {
        styleText: result.styleText.trim(),
        styleName: result.styleName.trim(),
      }
    } catch (error) {
      const err = ensureError(error)
      this.logger.error({ error: err }, 'Failed to generate style text from image')
      throw new BadRequestException(`Failed to generate style text: ${err.message}`)
    }
  }

  async generateNameFromText(styleText: string): Promise<{ styleName: string }> {
    if (!styleText?.trim()) {
      throw new BadRequestException('Style text is required')
    }

    const prompt = `Given this video style description, generate a short 1–2 word display name for the style. Examples: "Organic Boho", "Raw Macro", "Cinematic Drift", "Atmospheric Twilight", "Editorial Clean". Return only the name, nothing else.\n\nStyle description: ${styleText.trim()}`

    try {
      const result = await completion({
        models: ['gemini-3.8-flash', 'gpt-4o-mini'],
        prompt,
        responseFormat: StyleNameSchema,
        task: 'long-take-style-text',
        responseValidator: (r) => r.styleName.trim().length > 0,
      })
      return { styleName: result.styleName.trim() }
    } catch (error) {
      const err = ensureError(error)
      this.logger.error({ error: err }, 'Failed to generate style name from text')
      throw new BadRequestException(`Failed to generate style name: ${err.message}`)
    }
  }
}
