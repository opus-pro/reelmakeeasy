export function buildLongTakeUserAssetUnderstandingPrompt(params: {
  mime: string
  shortname: string
}): string {
  const shortname = params.shortname?.trim() || 'unknown_file'
  const mime = params.mime?.trim() || 'unknown'

  return `Role: Visual Asset Analyst for Story Mode.

Task: Analyze the provided image and extract objective visual facts.

Input metadata:
- shortname: ${shortname}
- mime: ${mime}

Rules:
1. Describe only what is visually observable in the image.
2. Do not invent identities, brands, or context not visible in pixels.
3. Keep "description" concrete (3-8 sentences). For images containing people or characters, you MUST include ALL of the following observable details:
   - Clothing: exact garment types, colors, patterns, layering (e.g. "navy blue zip-up hoodie over a white t-shirt")
   - Hairstyle: color, length, texture, style (e.g. "shoulder-length wavy auburn hair with side part")
   - Skin tone and complexion
   - Facial features: glasses, facial hair, expression, distinguishing marks
   - Accessories: jewelry, hats, bags, watches, held objects
   - Footwear if visible
   - Body type and approximate age range
   Do NOT generalize these as "standard attire" or "casual clothing" — be specific.
4. "tags" should be short tokens useful for retrieval (e.g. "person", "logo", "dashboard_ui", "product", "office", "document").
5. "entities.characters" are visible people/person-like entities.
6. "entities.objects" are salient non-person objects/products/UI elements.
7. "entities.brands_or_text" includes readable text/brand terms only when clearly visible.
8. Set quality flags conservatively. Set "quality.text_heavy_infographic" to true only when text blocks, diagrams, charts, or data are the primary informational content and dominate the meaningful image area. Set it false for cast sheets, character/reference/contact sheets, or multi-view product sheets when text is limited to names, view labels, or short captions and the visual subjects remain primary.

Output only valid JSON with this schema:
{
  "description": "string",
  "tags": ["string"],
  "entities": {
    "characters": ["string"],
    "objects": ["string"],
    "brands_or_text": ["string"]
  },
  "quality": {
    "low_quality": false,
    "text_heavy_infographic": false,
    "watermark": "none"
  }
}`
}
