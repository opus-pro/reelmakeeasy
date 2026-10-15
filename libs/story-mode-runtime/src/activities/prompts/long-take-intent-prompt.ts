export function buildLongTakeIntentPrompt(userPrompt: string): string {
  return `Input:
- Original and raw, uninterpreted user prompt: ${userPrompt}
  * This prompt comes directly from a user who wants to generate a high quality video. It could be any type of video content, with any goal. It's your job to find out what the user wants.

Goal: Analyze and interpret the user's prompt:
- Identify the user's intent.
- Identify the user's goal: What's the video content supposed to accomplish?
- What's the content's purpose?
- What type of video is it? What is the medium? (DO NOT talk about visual style yet, just focus on content type (eg. entertaining or educational, etc.) and think about the common denominators in these types of videos, regardless of their style.)

Your output must be a thorough analysis so we have an in-depth understanding of what the user wants, what's the ideal outcome, and what's the goal of the content etc.

You may add any relevant information that you find during your analysis.`
}
