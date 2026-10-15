import type { Message } from '../types'

import { ArticlePromptFacts, renderArticleContextBlock } from './article-prompt-facts'
import { BrandPromptFacts, renderBrandContextBlock } from './brand-prompt-facts'
import { SCRIPT_WORD_CAP } from './script-word-cap-audit'

/**
 * Reference image (from describe_uploaded_images) threaded into the
 * script tool so the LLM can ground the script in the user's uploads.
 * Replaces the heavier AssetDescriptionItem contract -- callers map
 * down before invoking the tool.
 */
export interface ScriptReferenceImage {
  description: string
  filename?: string
}

/**
 * The two prompts (FULL / PARTIAL) share the same role + RULES + brief
 * + chat-context body; they only differ in the scope-specific output
 * directive at the bottom (whole script vs only target shots).
 *
 * The CONVERSATION block from the user-supplied source prompt is
 * intentionally NOT included here -- script-direction refinement
 * questions are handled by the planner during the mode_confirmation
 * phase (see mode-confirmation-prompt section 2.6), so by the time this tool
 * runs we already have whatever clarification the user offered. The
 * tool itself is single-shot WRITE: SCRIPT DETECTION (passthrough) or
 * normal generation, no Q&A.
 */
export interface FullScopeScriptPromptInput extends ScriptToolPromptInput {
  /**
   * Planner-supplied edit_mode for FULL regen.
   * - CREATIVE: free rewrite of the entire script (typical bootstrap +
   *   typical refinement full-script refresh).
   * - EXACT: rewrite the entire script BUT keep `exactLocks` text
   *   verbatim in the matching shots. Used when the planner wants
   *   global pacing / tone changes while preserving specific lines
   *   the user already approved.
   */
  editMode: 'CREATIVE' | 'EXACT'
  /**
   * Locked lines per shot. EXACT only -- the rewritten script's
   * matching shot MUST contain this text verbatim. Empty array =
   * no locks.
   */
  exactLocks: Array<{ shot_id: string; text: string }>
  /**
   * Current shots in the spec, JSON-stringified. Empty `[]` for
   * bootstrap_script (first FULL gen, no shots yet); populated for
   * refinement FULL regen.
   */
  existingShotsJson: string
  /**
   * Per-shot word budget for the existing script. Empty / "(no
   * existing shots)" for bootstrap. For refinement, helps the LLM
   * keep the rewrite consistent with the surrounding shots' pace.
   */
  globalShotWordBudgetJson: string
  /**
   * Previous full script text. "(none)" for bootstrap; populated
   * for refinement FULL regen so the LLM knows what was there
   * before.
   */
  previousScript: string
  scope: 'FULL'
}

export interface PartialScopeScriptPromptInput extends ScriptToolPromptInput {
  /**
   * EXACT preserves verbatim text from `exactLocks`; CREATIVE allows
   * rewriting target shots' audio_vo subject to the budget + brief.
   */
  editMode: 'CREATIVE' | 'EXACT'
  exactLocks: Array<{ shot_id: string; text: string }>
  existingShotsJson: string
  /**
   * Per-shot word budget for the global script (already-existing
   * shots' audio_vo word counts). Helps the LLM keep partial
   * rewrites consistent with the surrounding shots' rhythm.
   */
  globalShotWordBudgetJson: string
  /**
   * Previous full script text for context -- the LLM should preserve
   * non-target shots verbatim and only rewrite the target ones.
   */
  previousScript: string
  scope: 'PARTIAL'
  targetShotIds: string[]
  /**
   * Pre-computed PARTIAL-rewrite headroom against the SCRIPT_WORD_CAP
   * hard cap. The LLM rewrites only target shots and must
   * preserve non-target shots verbatim, so the merged-script word
   * count after rewrite = (sum of non-target current audio_vo words)
   * + (sum of rewritten target audio_vo words). This object hands the
   * LLM the precise breakdown so it can plan its rewrite under the
   * cap instead of relying on a vague "total budget" hint.
   *
   * - `nonTargetWordCount`: words already locked in by the non-target
   *   shots' verbatim audio_vo. The LLM cannot change this.
   * - `targetCurrentWordCount`: words currently in the target shots
   *   (the BEFORE state of the rewrite).
   * - `rewriteHeadroom`: max(0, SCRIPT_WORD_CAP - nonTargetWordCount).
   *   The maximum total spoken words the rewritten target shots can
   *   sum to without busting the per-video TTS cap. May be smaller
   *   than the rewrite would naturally want if the existing
   *   non-target shots are already long.
   */
  wordCapBudget: {
    nonTargetWordCount: number
    rewriteHeadroom: number
    targetCurrentWordCount: number
  }
}

export interface ScriptToolPromptInput {
  /**
   * Optional article source facts.
   * When present, an ARTICLE SOURCE block (title / attribution / text +
   * grounding rules) is rendered ahead of the brand section so the script
   * states what the article states. Null/undefined on non-news sessions,
   * in which case prompts are byte-identical.
   */
  article?: ArticlePromptFacts | null
  /**
   * Optional Tier 1 brand facts. When present, a BRAND CONTEXT block is
   * rendered between VIDEO BRIEF and REFERENCE UPLOADS so the LLM grounds
   * script copy in the user's brand (business name, about, CTA, narrative
   * arc). Null/undefined on non-brand sessions, in which case the block is
   * left out.
   */
  brand?: BrandPromptFacts | null
  /**
   * Word budget hint for the LLM. `targetWords` is the rough word
   * count (durationSeconds / 60 * 160 WPM); `maxWords` is the upper
   * bound that triggers a runtime word-cap audit downstream.
   */
  budget: { maxWords: number; targetWords: number }
  /**
   * Recent transcript -- the script-direction refinement Q&A from
   * mode_confirmation lives here as natural-language history.
   */
  conversationHistory: Message[]
  durationSeconds: null | number
  /**
   * Effective TTS word cap (1700). Threaded into COMMON_RULES + the
   * PARTIAL-rewrite "merged-script cap" copy so the LLM is told the real
   * ceiling instead of the static SCRIPT_WORD_CAP.
   */
  effectiveMaxScriptWords?: number
  /**
   * When true, allow supported inline TTS markup in generated scripts, but
   * only when the user explicitly asks for emotion tags, pronunciation
   * mapping, or voice direction.
   */
  enableTtsMarkup?: boolean
  /**
   * Reference uploads described by describe_uploaded_images. Used
   * for both FULL (inform the script subject) and PARTIAL (anchor
   * the rewrite in the same uploads).
   */
  imageAnalyses?: ScriptReferenceImage[]
  /**
   * The pinned raw user prompt. The SCRIPT DETECTION block keys off
   * this -- if it contains narrative text reading as the video
   * itself, the LLM should preserve it verbatim.
   */
  rawUserPrompt: string
  /**
   * Structured brief produced by `generate_intent_context`
   * (global_constraints). Stringified JSON of topic / video_type /
   * audience / tone / style / pacing / key_entities / etc.
   */
  structuredBrief: string
}

function buildCommonRules(effectiveMaxScriptWords: number, enableTtsMarkup = false): string {
  const spokenOnlyRule = enableTtsMarkup
    ? '1. Spoken words only. Exception: supported inline TTS markup is allowed when the user asks for a specific tone, specific pronunciation, emotion tags, pronunciation mapping, or voice direction; see INLINE TTS MARKUP.'
    : '1. Spoken words only. No stage directions, brackets, or labels.'
  const ttsMarkupRules = enableTtsMarkup
    ? `

INLINE TTS MARKUP:
- Use markup when the user asks for a specific tone, specific pronunciation, pronunciation mapping, emotion tags, vocal delivery, or similar voice direction in the raw prompt or chat context.

SUPPORTED FORMAT:
- Emotion tags: [happy], [sad], [angry], [fearful], [disgusted], [surprised], [calm].
- Pronunciation mapping: {display word|pronunciation}.

PRONUNCIATION IS NOT A REWRITE:
- If the user says "pronounce X as Y", "the pronunciation of X should be Y", or similar, keep X as the visible spoken word and attach Y only inside the inline mapping.
- Correct: {Zibubu|zi-bia-bia}
- Incorrect: Zi-bia-bia
- Incorrect: Zibubu, pronounced zi-bia-bia
- Incorrect: the Zi-bia-bia toy
- Never replace the product/person/brand name with the pronunciation spelling.

EXAMPLE:
User request:
create a video for Aesop hand soap. use calm premium tone, and the pronunciation of "Aesop" should be "ee-sop".

Correct script:
[calm] A sink can feel ordinary until the small details change. {Aesop|ee-sop} hand soap turns a daily rinse into a quiet ritual: warm water, clean fragrance, and a bottle that makes the counter feel considered. Simple, useful, and just elevated enough to notice.

FINAL SELF-CHECK:
- If the user requested pronunciation, the returned script MUST contain at least one {display word|pronunciation} mapping.
- If the user requested emotion, tone, or vocal delivery, the returned script SHOULD contain one supported emotion tag.
- If the script contains pronunciation spelling as a replacement for the display word, rewrite before returning.`
    : ''
  return `RULES:
${spokenOnlyRule}
2. Only use facts from the brief and any research / grounding the model has access to. Never invent statistics or claims.
3. Marketing and ads end with a CTA.
4. Adhere to the user's stated preferences (from the brief and the chat context).
5. Word budget: hit the target word count specified below. **Never exceed the hard-cap word count** -- the downstream TTS vendor has a ${effectiveMaxScriptWords}-word per-video limit, and any over-cap script disables the "Create video" button until the user trims. Aim for the target; treat the cap as inviolable.
6. **Self-check before returning.** Count the words in your draft. If the count exceeds the hard-cap word count, you have failed -- compress filler clauses, merge adjacent ideas, and drop the least-essential example until the count fits, then return. Do NOT return an over-cap script and rely on downstream trimming.
7. The user chose the direction. Find an unexpected way in.
8. **English only (for now)**: write the voice-over script in English, whatever language the brief or the chat uses. If the user supplies a script in another language, translate it into English while preserving its structure, meaning and any per-shot segmentation. Keep brand names and proper nouns as written. (Captions can only be rendered in English today; other languages come later.)

If the brief mentions a specific product, brand, or topic, use grounded research / your training-data knowledge to get accurate details before writing. Do not invent product specs / claims that are not in the brief and not grounded.${ttsMarkupRules}`
}

function buildScriptDetection(effectiveMaxScriptWords: number): string {
  return `SCRIPT DETECTION -- handle FIRST:

# HARD CONTRACT (read before anything else in this section)

If the user's pinned raw prompt contains an explicit wrapping label on its own line -- "Here's the script:", "Here is the script:", "Script:", "Voiceover:", "Narration:", "Transcript:", "Final Script:", or "Complete Voiceover Script:" (any case, optional Markdown decorators around the label, straight OR curly apostrophe) -- followed by content that **reads as finished VO narration** (continuous spoken sentences meant to be read aloud) and fits under the ${effectiveMaxScriptWords}-word cap, you MUST emit that prose **character-for-character** in the "script" field. Same words. Same punctuation. Same line breaks. Same capitalization. Same regional spelling. **Do not paraphrase. Do not condense. Do not "improve" the wording. Do not add a hook or a closer. Do not swap "Mum" for "mom" or vice versa. Do not add em-dashes the user did not write.**

This contract does NOT apply (treat as a brief and generate normally) when:
- The content after the label is **bullet points / outline / directives to you** ("make it warm", "30 seconds", "mention the brand twice", "punchy tone") rather than finished spoken narration.
- The content contains **non-spoken structural metadata** (Scene N, INT./EXT., Camera:, [SFX], speaker tags, timestamps) -- those signal a screenplay/treatment, not a clean pasted script. **Exception:** a pre-segmented per-shot script using "SHOT N:" labels or a clean numbered list of spoken segments is allowed -- see the "Pre-segmented user script" rule below; preserve the spoken text verbatim with only the segmentation label stripped from each audio_vo.

When the contract DOES apply, any deviation from the user's verbatim prose is a contract violation. This rule overrides every other style / tone / rewriting guideline in this prompt. The "preserve user wording exactly" line further down is the same rule -- this top-of-section restatement exists because LLMs at non-zero temperature routinely drift toward "improved" prose despite that instruction.

EXAMPLE OF CORRECT BEHAVIOR (contract applies):
  Input:
    Create a story video about a paper round boy.

    Here's the script:

    Jed never wanted a paper round. He hates getting up early.
  Correct "script" field:
    "Jed never wanted a paper round. He hates getting up early."
  Wrong (every one of these is a contract violation):
    "Jed never wanted a paper round -- he hates early mornings."
    "Jed never asked for a paper round."
    "Jed never wanted a paper round. He hates the early mornings."

EXAMPLE WHERE THE CONTRACT DOES NOT APPLY (treat as brief):
  Input:
    Make a 30-second ad for our coffee brand.

    Voiceover:
    - warm and conversational tone
    - mention "freshly roasted" twice
    - end with the brand name
  Correct behavior:
    Generate a fresh script from the brief. The bullet points are
    direction to you, not finished narration -- do not paste them into
    "script".

# Detection rules

Read the user's pinned raw prompt **word by word, phrase by phrase**. For every span of text, decide ONE of:
- (a) it is **spoken-word content** the viewer is meant to hear, OR
- (b) it is **structural metadata** that describes the video, the scene, the camera, the speaker, the timing, the visuals, the format, or any other production direction.

(a) goes into "script". (b) does NOT -- ever. The downstream TTS will literally read out whatever you include, so a single leaked "SCENE 1" or "Camera: medium shot" or "Narrator:" becomes part of the spoken audio. Be stringent; this is the whole job of this section.

# (b) NON-SPOKEN STRUCTURAL METADATA -- always strip, never put in "script"

Recognize and discard each of these wherever they appear:
- Scene / chapter / episode / act labels: "SCENE 1", "EPISODE 1", "Chapter 2", "Act II", "INT./EXT.", "FADE IN:"
- Timestamps used as section markers: "0:00-0:10", "[00:35]", "Runtime: ~18 Minutes", "(5 seconds)"
- Camera / direction lines: "Camera:", "Medium shot", "eye-level", "static", "push-in", "tracking shot", "slow dolly"
- Action lines / stage directions (blocks describing what characters DO rather than what they SAY)
- Speaker tags + dialogue prefixes: "BUDDY:", "ESSIE (V.O.)", "NARRATOR:", "ANNOUNCER:", "VOICEOVER:"
- Audio / SFX / music cues: "[BACKGROUND MUSIC]", "(pause)", "(beat)", "<break>", "SFX:"
- Text overlay / caption specs: "Text Overlay:", "Caption:", "Subtitle:", "🎬 TITLE CARD"
- Per-snippet word-count / emphasis annotations: "[14 words | Emphasis: 'fifty-dollar', 'important']"
- Markdown / emoji structural headers: "🎬", "🌍 SERIES STYLE", "🎭 MAIN CHARACTERS", "⏱️ EPISODE TIMELINE", "##", "###", "---"
- Style / genre / character description blocks: "VISUAL", "MOOD", "GENRES:", "CHARACTERS:", "STYLE:"
- Bullet outlines / numbered lists used as outline structure (not as a per-shot script -- see "shot-segmentation labels" below for the distinction)

If you see ANY of these in the input, the input is structurally a brief or screenplay -- NOT a clean "Script only" case. Scan it more carefully and extract only the spoken-word parts.

# Shot-segmentation labels -- a DIFFERENT case from (b)

"SHOT 1: ...", "Shot 1A - ...", "Shot 1 -- ...", or a clean numbered list ("1. ... 2. ... 3. ...") where each item is one spoken segment do NOT count as production-metadata disqualifiers in (b). They signal user intent to map spoken lines to specific video shots. Handle them via the "Pre-segmented script" assembly path below: keep the spoken text verbatim in "script", populate "shot_edits" per segment, and strip ONLY the segmentation label itself ("SHOT 1:", "1.") from each segment's audio_vo. Do NOT demote a clean per-shot script to "Prompt + script" just because it carries shot labels.

# (a) SPOKEN-WORD CONTENT -- preserve exactly, only this goes in "script"

Recognize and extract:
- Continuous prose written in first-person, direct-to-camera voice, or any tone clearly meant to be read aloud
- Quoted lines explicitly marked as voiceover / dialogue (e.g. \`0:00-0:05 (5 seconds) "Buddy bought a fifty-dollar HDMI cable."\` -- the quoted portion only; strip the timestamp + duration prefix and the "[N words | Emphasis: ...]" annotation that may follow)
- A clearly-marked footer / summary block such as "COMPLETE VOICEOVER SCRIPT:", "Final Script:", "Voiceover:", "Narration:" -- the prose underneath the header is the full intended VO, use that and ignore per-shot snippets above
- Spoken text immediately after a wrapping label ("script:", "voiceover:", "transcript:", "narration:") -- strip the label, keep the prose

Within any span you keep, preserve user wording exactly: same words, same punctuation, same line breaks. Do not paraphrase, "improve", or condense.

# ASSEMBLY -- after the scan, populate "script" based on what spoken content you found

- All spoken, no structural metadata anywhere -> "script" = full input verbatim.
- Mixed input (the common screenplay / scene-by-scene case) -> "script" = ONLY the spoken portions, in order, with all (b) tokens stripped. Prefer a clearly-marked footer ("COMPLETE VOICEOVER SCRIPT", etc.) when present; otherwise concatenate per-snippet quoted VO lines in time order.
- Pre-segmented user script (the user expressed clear per-shot segmentation intent -- "SHOT 1: ...", numbered list of segments) -> preserve full spoken text in "script" AND populate "shot_edits" with one entry per intended segment in order: shot_id = "shot_1", "shot_2", ... (lowercase, 1-indexed); audio_vo = the spoken text of that segment with any segmentation label / metadata stripped. The downstream runtime validates these against the selected model's shot-duration envelope and repairs or re-segments invalid cuts. If the user did NOT clearly express segmentation intent, leave shot_edits empty -- when in doubt, default to empty.
- No identifiable spoken content (brief, instructions, outline only) -> "script" = empty; the normal generation flow below writes a fresh one. shot_edits stays empty.

**When in doubt about a single span, treat it as structural metadata (strip) rather than spoken (include).** Regenerating a missing line downstream is recoverable; reading "Camera: medium shot, eye-level, static" out loud in the final video is not.

**OVERRIDE -- ${effectiveMaxScriptWords}-word cap is non-negotiable**: if the spoken text you would otherwise preserve exceeds ~${effectiveMaxScriptWords} words, do NOT take the "preserve exactly" branches. The TTS vendor's per-video cap is a hard limit; even verbatim user text must fit under it. Treat the over-cap text as a content brief: generate a fresh <=${effectiveMaxScriptWords}-word version that captures the original's intent, subject, tone, and key points within the word budget.`
}

function renderArticleSection(article: ArticlePromptFacts | null | undefined): string {
  const block = renderArticleContextBlock(article ?? null)
  return block ? `${block}\n\n` : ''
}

function renderBrandSection(brand: BrandPromptFacts | null | undefined): string {
  const block = renderBrandContextBlock(brand ?? null)
  return block ? `${block}\n\n` : ''
}

function renderBudgetHint(
  budget: { maxWords: number; targetWords: number },
  durationSeconds: null | number,
): string {
  const durationLine =
    durationSeconds && durationSeconds > 0
      ? `Target video duration: ~${durationSeconds}s.`
      : 'Target duration: not explicitly set; aim for the word range below.'
  return `${durationLine}\nWord budget: aim for ~${budget.targetWords} words. Hard cap at ${budget.maxWords} words (do NOT exceed -- this is the TTS vendor's per-video word limit; over-cap scripts disable the "Create video" button).`
}

function renderConversationHistory(messages: Message[]): string {
  if (messages.length === 0) {
    return '(no prior conversation)'
  }
  return messages
    .map((message) => {
      const role = message.role === 'user' ? 'User' : 'Assistant'
      const content = message.content?.trim() ?? ''
      return `${role}: ${content}`
    })
    .join('\n\n')
}

function renderReferenceImages(images: ScriptReferenceImage[] | undefined): string {
  if (!images || images.length === 0) {
    return '(no uploaded reference images)'
  }
  return images
    .map((image, index) => {
      const label = image.filename?.trim() || `Image ${index + 1}`
      const description = image.description?.trim() ?? ''
      return `- ${label}: ${description}`
    })
    .join('\n')
}

const OUTPUT_CONTRACT_FULL = `OUTPUT CONTRACT (strict):
Return ONLY a JSON object with this shape:
{
  "script": "<the full script as a single string of spoken words>",
  "shot_edits": []
}

"script" is the entire spoken voiceover (single concatenated string).

"shot_edits" rules -- READ CAREFULLY. The DEFAULT and overwhelmingly common case is \`[]\` (empty array):

- **Generating from a brief** (SCRIPT DETECTION did not match): shot_edits MUST be an empty array \`[]\` in FULL scope. Do NOT propose your own shot segmentation. Segmentation is the dedicated downstream beat-sheet expert's responsibility and enforces the selected model's shot-duration envelope. Returning non-empty shot_edits would bypass that envelope and ship over-/under-cap shots.
- **Preserving an unsegmented user script** (SCRIPT DETECTION matched, but the user's text shows no clear per-shot segmentation intent): shot_edits MUST be an empty array \`[]\` in FULL scope. Do NOT propose your own shot segmentation. The verbatim script goes in "script"; the downstream beat-sheet expert will segment it under the selected model's duration envelope.
- **Preserving a pre-segmented user script (the only exception)**: ONLY when the user clearly expressed a per-shot segmentation intent (explicit labels like "SHOT 1: ...", "Shot 1 - ...", a numbered list of distinct segments, or any other obvious one-shot-per-item structure -- in any language). In that case populate shot_edits with one entry per intended segment in the user's order: shot_id = "shot_1", "shot_2", ... (lowercase, 1-indexed); audio_vo = the spoken text of that segment with any segmentation label / metadata stripped. Note: the runtime validates these user-intended cuts against the selected model's shot-duration envelope and may repair or re-segment invalid cuts, so only honor clear user segmentation intent.

If you are uncertain whether the user expressed shot segmentation intent, default to \`[]\`.

When edit_mode=EXACT and exact_locks are listed, the rewritten script MUST contain each lock's text verbatim within the script body. The lock's shot_id is a hint about ordering, not a hard mapping for FULL; this rule affects "script" content only and does NOT change the \`shot_edits\` rule above.

No markdown fences, no extra commentary, no other top-level keys.`

function renderOutputContractFull(enableTtsMarkup = false): string {
  if (!enableTtsMarkup) {
    return OUTPUT_CONTRACT_FULL
  }
  return OUTPUT_CONTRACT_FULL.replace(
    '"script" is the entire spoken voiceover (single concatenated string).',
    '"script" is the entire spoken voiceover (single concatenated string). When inline TTS markup is requested, "script" must preserve supported markup exactly. Pronunciation requests must be represented as {display word|pronunciation}, not as spoken explanation or replacement text.',
  )
}

const OUTPUT_CONTRACT_PARTIAL = `OUTPUT CONTRACT (strict):
Return ONLY a JSON object with this shape:
{
  "script": "<the full updated script as a single string of spoken words, with the rewritten target shots merged in>",
  "shot_edits": [
    { "shot_id": "shot_2", "audio_vo": "<rewritten spoken text for this shot>" }
  ]
}
- "script" is the FULL merged script (rewritten target shots + non-target shots verbatim, joined in shot order).
- "shot_edits" contains EXACTLY one entry per target shot id, audio_vo = the new spoken text. Keep entries in the same order as the listed target_shot_ids.
- Do NOT include shot_edits for non-target shots.
- **Output consistency (hard)**: applying shot_edits to the existing shots in order must reconstruct the merged "script" verbatim. The two fields must agree.
- No markdown fences, no extra commentary, no other top-level keys.`

function renderOutputContractPartial(enableTtsMarkup = false): string {
  if (!enableTtsMarkup) {
    return OUTPUT_CONTRACT_PARTIAL
  }
  return OUTPUT_CONTRACT_PARTIAL.replace(
    '- "script" is the FULL merged script (rewritten target shots + non-target shots verbatim, joined in shot order).',
    '- "script" is the FULL merged script (rewritten target shots + non-target shots verbatim, joined in shot order). When inline TTS markup is requested, "script" must preserve supported markup exactly. Pronunciation requests must be represented as {display word|pronunciation}, not as spoken explanation or replacement text.',
  ).replace(
    '- "shot_edits" contains EXACTLY one entry per target shot id, audio_vo = the new spoken text. Keep entries in the same order as the listed target_shot_ids.',
    '- "shot_edits" contains EXACTLY one entry per target shot id, audio_vo = the new spoken text. When inline TTS markup is requested, audio_vo must preserve supported markup exactly. Pronunciation requests must be represented as {display word|pronunciation}, not as spoken explanation or replacement text. Keep entries in the same order as the listed target_shot_ids.',
  )
}

// Public prompt builders used by the script generation tool.
export function buildFullScopeScriptPrompt(input: FullScopeScriptPromptInput): string {
  const exactLocksLine =
    input.editMode === 'EXACT' && input.exactLocks.length > 0
      ? input.exactLocks.map((lock) => `  - ${lock.shot_id}: "${lock.text}"`).join('\n')
      : '(no exact locks)'

  // Distinguish two EXACT intents on scope=FULL:
  //   1. Targeted minimal edit ("add two words at the end"): a prior script
  //      exists AND there are no exact_locks. The intent is a localized change,
  //      not a rewrite -- preserve the existing script verbatim and apply only
  //      the requested change. Without this, scope=FULL regenerates everything
  //      (the entire-rewrite copy below only pins exact_locks, usually empty),
  //      losing the user's wording.
  //   2. Full rewrite keeping approved lines ("rewrite the whole script but keep
  //      shot 2 exactly"): exact_locks are present -> keep the original
  //      full-rewrite-with-locks path so the requested refresh still happens.
  // "(none)" previousScript = first/bootstrap generation -> full rewrite.
  const hasPreviousScript =
    input.previousScript.trim().length > 0 && input.previousScript.trim() !== '(none)'
  const isTargetedEdit = hasPreviousScript && input.exactLocks.length === 0

  const editModeBlock =
    input.editMode === 'EXACT'
      ? isTargetedEdit
        ? `SCOPE -- targeted EDIT of the existing script (edit_mode=EXACT, no locks):
- This is a minimal edit, NOT a rewrite. Unless SCRIPT DETECTION above applies (the user pasted a full replacement script), reproduce the PREVIOUS SCRIPT below VERBATIM and apply ONLY the specific change the user requested in RAW USER PROMPT / CHAT CONTEXT (e.g. add / remove / replace the exact words, phrase, or sentence at the position they named).
- Keep every other line character-for-character: same words, punctuation, ordering, capitalization, and regional spelling. Do NOT rephrase, reorder, condense, retitle, add a hook/closer, or "improve" any unaffected part.
- If the location is implied rather than explicit (e.g. "at the end" -> append to the final line; "the intro" -> the opening line), apply the change there and leave everything else untouched.`
        : `SCOPE -- FULL rewrite (edit_mode=EXACT):
- Rewrite the entire script, BUT every locked line below MUST appear verbatim somewhere in the new script (use the lock's shot_id as a hint about ordering).
- exact_locks:
${exactLocksLine}`
      : `SCOPE -- FULL rewrite (edit_mode=CREATIVE):
- Rewrite the entire script freely within the brief and the chat-context direction.
- No locked lines.`

  const effectiveCap = input.effectiveMaxScriptWords ?? SCRIPT_WORD_CAP
  const enableTtsMarkup = input.enableTtsMarkup === true
  return `You are a short-form video scriptwriter.

The system already knows the video type and duration; the user's mode/duration/topic and any direction-refinement clarifications are below in CHAT CONTEXT. Do not ask any questions in this turn -- write the script directly (or preserve the user's pasted script per SCRIPT DETECTION).

${buildScriptDetection(effectiveCap)}

${buildCommonRules(effectiveCap, enableTtsMarkup)}
${renderBudgetHint(input.budget, input.durationSeconds)}

${editModeBlock}

VIDEO BRIEF (structured global constraints):
${input.structuredBrief}

${renderArticleSection(input.article)}${renderBrandSection(input.brand)}REFERENCE UPLOADS:
${renderReferenceImages(input.imageAnalyses)}

EXISTING SHOTS (canonical -- empty [] on first generation; populated on a full-script refresh):
${input.existingShotsJson}

PER-SHOT WORD BUDGET (rough; helps keep the rewrite paced like the existing script when present):
${input.globalShotWordBudgetJson}

PREVIOUS SCRIPT (the prior full script -- "(none)" on first generation):
${input.previousScript}

RAW USER PROMPT (pinned -- check first for SCRIPT DETECTION):
${input.rawUserPrompt}

CHAT CONTEXT (recent transcript -- use for direction / tone / refinements):
${renderConversationHistory(input.conversationHistory)}

${renderOutputContractFull(enableTtsMarkup)}
`
}

export function buildPartialScopeScriptPrompt(input: PartialScopeScriptPromptInput): string {
  const exactLocksLine =
    input.editMode === 'EXACT' && input.exactLocks.length > 0
      ? input.exactLocks.map((lock) => `  - ${lock.shot_id}: "${lock.text}"`).join('\n')
      : '(no exact locks; CREATIVE rewrite of target shots)'

  const effectiveCap = input.effectiveMaxScriptWords ?? SCRIPT_WORD_CAP
  const enableTtsMarkup = input.enableTtsMarkup === true
  return `You are a short-form video scriptwriter editing an existing video script.

You are rewriting the audio_vo of specific target shots only. Non-target shots stay EXACTLY as they appear in PREVIOUS SCRIPT below. Do not ask questions; write the rewrite directly.

${buildCommonRules(effectiveCap, enableTtsMarkup)}

${renderBudgetHint(input.budget, input.durationSeconds)}

SCOPE -- PARTIAL rewrite:
- edit_mode: ${input.editMode}
- target shot ids (rewrite ONLY these, in this order): ${JSON.stringify(input.targetShotIds)}
${input.editMode === 'EXACT' ? `- exact_locks (the rewritten audio_vo for these shots MUST contain the locked text verbatim):\n${exactLocksLine}` : '- (CREATIVE) rewrite freely within the brief and global tone.'}
- Preserve audio_vo of every non-target shot byte-for-byte. Do NOT re-segment, re-order, delete, or add shots. shot count + shot ids unchanged.

PARTIAL hard rules:
- **Style consistency**: rewritten target lines MUST match the voice / tone / cadence / vocabulary of the existing non-target shots in PREVIOUS SCRIPT below. A PARTIAL edit should read as if the same author wrote the whole script -- do not drift register, do not adopt a different narrator persona, do not introduce rhetorical patterns absent from the rest of the script. The existing shots are the binding style reference.
- **Per-shot word budget**: each rewritten target line MUST stay within \`PER-SHOT WORD BUDGET\`'s allowed_min..allowed_max (when present). Do NOT apply a single global word target across all target lines -- the budget is per-shot. If a candidate line falls outside the per-shot range and the user did not explicitly ask to expand / compress, rewrite it until it fits.
- **Merged-script TTS cap (HARD)**: the COMPLETE merged "script" you return (rewritten target shots + every non-target shot's verbatim audio_vo, joined in shot order) MUST stay <= ${effectiveCap} words. Non-target shots already account for ${input.wordCapBudget.nonTargetWordCount} words; the target shots currently total ${input.wordCapBudget.targetCurrentWordCount} words. Your rewritten target shots must sum to <= ${input.wordCapBudget.rewriteHeadroom} words combined to keep the merged script under the TTS cap. If your candidate rewrite would exceed this headroom, compress before returning.
- **No length inflation**: only expand or compress substantially when the user explicitly asks for it. CREATIVE does NOT mean longer by default. Do not pad target lines with synonym-heavy paraphrase. If a rewritten line is longer than the original, the added words must introduce concrete new on-screen value, not restate existing content.

VIDEO BRIEF:
${input.structuredBrief}

${renderArticleSection(input.article)}${renderBrandSection(input.brand)}REFERENCE UPLOADS:
${renderReferenceImages(input.imageAnalyses)}

EXISTING SHOTS (canonical):
${input.existingShotsJson}

PER-SHOT WORD BUDGET (rough; used to keep rewritten shots in pace with the rest):
${input.globalShotWordBudgetJson}

PREVIOUS SCRIPT (the full script -- preserve non-target shots verbatim):
${input.previousScript}

CHAT CONTEXT (recent transcript -- the user's latest direction for the rewrite):
${renderConversationHistory(input.conversationHistory)}

${renderOutputContractPartial(enableTtsMarkup)}
`
}
