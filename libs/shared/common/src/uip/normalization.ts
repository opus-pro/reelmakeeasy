export interface UipStyleInstruction {
  /**
   * NST-derived rich style prompt produced by `analyze_style`. When
   * present, supersedes `style_text` because it carries grounded
   * structural / palette / reproduction guidance derived from the user's
   * style reference image.
   */
  reusable_prompt?: string
  style_name?: string
  style_text?: string
  style_thumbnail_url?: string
}

export function normalizeStyleInstruction(style: null | UipStyleInstruction | undefined): string {
  if (!style) {
    return ''
  }

  const reusablePrompt = style.reusable_prompt?.trim() ?? ''
  const styleText = style.style_text?.trim() ?? ''

  // When `reusable_prompt` is present (NST style analysis ran on the user's
  // reference image), use it as the primary style instruction and drop
  // `style_text` -- the reusable prompt encodes the same intent at much
  // higher fidelity. Fall back to `style_text` otherwise so legacy / pre-
  // analysis sessions still get the user's seed style language.
  //
  // `style_name` and `style_thumbnail_url` are intentionally excluded:
  // downstream image-generation prompts that ask the model to preserve
  // packaging/brand text verbatim will render the user's display label
  // on-screen, and the thumbnail URL is pure token noise.
  return reusablePrompt
    ? `style_prompt: ${reusablePrompt}`
    : styleText
      ? `style_text: ${styleText}`
      : ''
}

export const formatStyleInstruction = normalizeStyleInstruction
