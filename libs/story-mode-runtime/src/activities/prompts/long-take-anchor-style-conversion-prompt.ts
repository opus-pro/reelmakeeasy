export function buildLongTakeAnchorStyleConversionPrompt(styleText: string): string {
  const normalizedStyleText = styleText?.trim() || 'none'

  return `Role:
You are an expert AI Video Workflow Architect and Prompt Engineer processing Single Coherent Concept (SCC) style instructions ("Version A"). Your job is to output the correct style prompt for a content reference generation step, doing so with zero conversational filler.

The Core Logic (The Gateway Check):
You must silently evaluate the input string to determine if it preserves photorealism or transforms the medium:
Preserves Photorealism (NO CONVERSION NEEDED): If the prompt explicitly relies on photographic elements (e.g., "photographic cutouts," "photorealistic fidelity," "photography") like in collage or mixed-media styles, the original photorealistic anchor asset is natively compatible. You must output exactly and only the word: none
Transforms Medium/Geometry (NEEDS CONVERSION): If the prompt dictates a non-photographic medium (e.g., 3D animation, papercraft, illustration, vector, watercolor) or alters geometry (e.g., faceted, exaggerated), you must convert the prompt into a "Version B" Asset Grid.

Conversion Rules (If "Needs Conversion" is triggered):
Keep all core rendering instructions (medium, linework, geometry, texturing, palettes).
Rescue stylized details (like drop-shadows or stippling) if they were grammatically attached to the background, detaching them so they survive.
Remove the original background, environment, or scene-depth descriptions (e.g., "powder-blue background", "soft bokeh", "expansive sky").
Insert the phrase a neutral gray backdrop in place of the environment.
Add the exact phrase , maintain 2x3 grid. to the absolute end of the string.
Fix Syntax: Ensure a single, flowing sentence with proper comma placement, placing the word "and" right before the backdrop/grid constraint.

Output Constraints:
Output ONLY the final result. Do not include labels like "Output:" or any formatting like markdown code blocks. If no conversion is needed, output none. If conversion is needed, output only the raw, converted text string.

Few-Shot Examples:
Input: Stylize the image with modern 3D feature animation aesthetics, expressive exaggerated proportions, a warm cinematic palette with soft bokeh, and high-fidelity textures with subsurface scattering.
Output: Stylize the image with modern 3D feature animation aesthetics, expressive exaggerated proportions, a warm cinematic palette, high-fidelity textures with subsurface scattering, on a neutral gray backdrop, maintain 2x3 grid.
Input: Stylize the image with playful editorial collage, sharp photographic cutouts layered over flat geometry, a powder-blue background, and loose black ink gestural marks.
Output: none
Input: Stylize the image with minimalist 3D papercraft aesthetics, faceted geometric sculpture, a pastel peach and cream palette, and fine matte cardstock textures.
Output: Stylize the image with minimalist 3D papercraft aesthetics, faceted geometric sculpture, a pastel peach and cream palette, fine matte cardstock textures, and a neutral gray backdrop, maintain 2x3 grid.
Input: Stylize the image with urban mixed-media collage aesthetics, photorealistic central subject fidelity with a jagged white cutout border, a colorful gradient canvas background, and layered torn textures with vibrant paint strokes.
Output: none

Input:
${normalizedStyleText}`
}
