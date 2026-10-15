import {
  buildLongTakeRoutedPromptTemplate,
  type LongTakePromptRoute,
} from '../../long-take-prompt-router'

export function buildLongTakeVideoPromptsPrompt(params: {
  promptRoute?: LongTakePromptRoute
  visualScript: unknown
}): string {
  const visualScriptJson = JSON.stringify(params.visualScript, null, 2)
  const lipSyncRule =
    params.promptRoute === 'music'
      ? 'For music-route videos, set requires_lip_sync=true only when the shot has non-empty audio/lyrics, used_asset_id includes a visible singer/rapper/vocalist/artist performer Character asset (including "char_singer" or another singer/rapper role asset), and the visual clearly frames that same performer singing, rapping, delivering a vocal performance, performing to camera as the vocalist, or with visible mouth/lip movement for the lyric. Do not mark true just because a Character asset appears as a story actor. Set requires_lip_sync=false for empty-audio/no-lyrics shots, B-roll, landscapes, objects/products, abstract visuals, anonymous crowds, dance-only shots, story-actor shots, or any shot where only non-singer characters appear. For every false shot, especially empty-audio/no-lyrics beats and singer close-ups, keep all visible mouths closed or neutral throughout; do not add speaking, singing, rapping, mouth movement, or lip movement unless the shot is explicitly selected for lip sync. For true shots, keep the generated prompt focused on that performer delivering the vocal, but do NOT introduce microphones, mic stands, headset mics, recording booths, or visible recording gear. Singing/rapping should read through the performer face, posture, and camera energy, not microphone props.'
      : 'Set requires_lip_sync=false for every shot. Lip sync is only enabled for music-video tracks.'

  const generalPrompt = `Role: Video-Generation Prompt Builder (Story Mode).

Task:
You are given a JSON visual script (array). For each segment, produce a concise, video-ready prompt suitable for Runway/Luma. Use visual.core_description as the core. If visual is missing, fall back to audio.

Rules:
1. Keep each prompt 1-2 sentences, present tense, concrete visuals only.
2. Preserve the original description content; only add minimal motion/camera cues to make it "video-ready".
3. Assume a single continuous take; avoid montage or multi-shot language.
4. Do not add shot numbers, labels, or extra commentary.
5. Avoid UI/JSON terms.
6. If a relevant notes.style_note or notes.motion_change exists, integrate it naturally, but do not invent new elements.
7. Keep prompts consistent in tone and level of detail.
8. Generate shot_id using the array index (1-based): shot_id = "LT_S" + index.
9. ${lipSyncRule}

Output Format:
Return a JSON object with a "shots" array:
{
  "shots": [
    { "shot_id": "LT_S1", "prompt": "...", "requires_lip_sync": false },
    { "shot_id": "LT_S2", "prompt": "...", "requires_lip_sync": true }
  ]
}
No extra keys. No surrounding text. Output must be valid JSON.

Input JSON:
${visualScriptJson}
`

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute: params.promptRoute,
    templateName: 'video-prompts',
  })
}
