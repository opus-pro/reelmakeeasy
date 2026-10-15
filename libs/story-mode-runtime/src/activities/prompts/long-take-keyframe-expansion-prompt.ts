export function buildLongTakeKeyframeExpansionPrompt(shotDescription: string): string {
  return `You are a panel expansion artist. Your job is to generate Panel 2 from the provided Panel 1 keyframe image.

Panel 1 = the input image (already provided as a reference).

Panel 2 = show a clear and significant visual progression 4 seconds later in time.
  * Avoid small pose changes or near-duplicate frames. The difference should feel like a later moment in time.
  * There must be enough visible change to support a full 4-second animation between the two panels.
  * The progression must involve clear, noticeable development such as: movement through space, transformation, buildup and release, action progression, environmental change, or emotional shift.

Panel 2 must preserve the same core character appearance, setting, lighting, style, and overall scene identity as Panel 1.

Do not include storyboard or layout text in the image.
Keep only text that is intentionally part of the scene itself.

Scene context:
${shotDescription}`
}
