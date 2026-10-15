import type {
  NotifyTextStreamPart,
  ReasoningStreamPart,
} from '@shared/types/api/agent/stream-parts'
import { z } from 'zod'

import { completion, type ModelChain } from '../../llm/completion'
import { ModelTier } from '../../llm/models/index'
import { renderPrompt } from '../../llm/prompt'
import { logger } from '../../logger'
import { ensureError } from '../../utils/error-handler'
import { runWithContext } from '../../utils/req-ctx'

export async function genMessage(
  prompt: string,
  task?: string,
  models: ModelChain | ModelTier = 'pro',
): Promise<string> {
  try {
    const response = await completion({
      models,
      prompt,
      responseFormat: z.string(),
      task: task || 'common-gen-message',
      temperature: 0,
    })

    return response.trim()
  } catch (err) {
    logger.error({ error: ensureError(err) }, 'Error generating message')
    return ''
  }
}
export async function genReasoningPartChunk(
  text: string,
  agentName: string,
): Promise<null | ReasoningStreamPart> {
  if (!text || text.trim().length === 0) {
    return null
  }

  const promptText = renderPrompt(
    `You will receive a reasoning message which describes what I plan to do next, but may contain unnecessary details or sensitive content.

Your task:
\t1.\tFocus only on the bold sections.
\t2.\tIdentify the essential action or preparation I should think about.
\t3.\tWrite one sentence in first person (“I…”), showing that I am reasoning about the problem and what I need to do or prepare.
\t4.\tKeep the tone like an internal thought process (trying to understand and plan).
\t5.\tDo not include technical details, tool names, code, file paths, URLs, or sensitive business/legal info.
\t6.\tKeep the output minimal, clear, and action-focused.

Here is the new input:
{{userInput}}`,
    {
      userInput: text,
    },
  )
  let summary: null | string = null
  try {
    summary = await runWithContext({ agent: agentName }, async () => {
      return await genMessage(promptText, 'gen-reasoning-part-chunk')
    })
  } catch (err) {
    logger.error({ error: ensureError(err) }, 'Error generating reasoning part chunk')
    return null
  }
  if (!summary || summary.trim().length === 0) {
    return null
  }

  return {
    type: 'reasoning',
    reasoning: summary,
    subAgentName: agentName,
  } as ReasoningStreamPart
}
export async function genReasoningSummaryChunk(
  text: string,
  isFirstSummary = false,
  originalUserInput?: string,
): Promise<NotifyTextStreamPart | null> {
  if (!text || text.trim().length === 0) {
    return null
  }

  let summary: null | string = null
  let promptText: string

  // Special handling for first reasoning summary: generate plan table
  if (isFirstSummary) {
    promptText = renderPrompt(
      `You are analyzing the user's request to create a video. Based on the user's original input and the reasoning text below, extract key information and present it as a clear plan table.

**User's Original Input:**
{{originalUserInput}}

**Reasoning text:**
{{userInput}}

Your task:

1. Analyze BOTH the user's original input AND the reasoning text to extract:

   - Video Type: Determine the most appropriate video type based on the user's request. Follow these rules in order:

     **Priority 1**: If the user explicitly mentions a video type (e.g., "explainer", "tutorial", "promotional", "educational", "documentary", "review", "news", "entertainment", "how-to", "product demo", "listicle"), use that exact type.

     **Priority 2**: If not explicitly mentioned, infer from the content and purpose:
     - **Explainer**: Explaining concepts, ideas, processes, or "how something works" (e.g., "how AI works", "what is blockchain", "explain quantum computing")
     - **Tutorial**: Step-by-step instructions to teach a skill or complete a task (e.g., "how to use Photoshop", "learn Python", "cooking recipe")
     - **How-to**: Similar to tutorial but more focused on specific tasks (e.g., "how to install", "how to set up")
     - **Educational**: Teaching academic or professional knowledge (e.g., "history lesson", "science facts", "business strategy")
     - **Promotional**: Marketing, advertising, or showcasing products/services (e.g., "product launch", "brand campaign", "sales pitch")
     - **Product Demo**: Demonstrating a specific product's features and benefits
     - **Review**: Evaluating or critiquing products, services, or content (e.g., "product review", "movie review", "app review")
     - **News**: Reporting current events, updates, or breaking news
     - **Entertainment**: Fun, engaging content for enjoyment (e.g., "funny moments", "top 10 lists", "viral content", "trending topics")
     - **Documentary**: Informative content about real events, people, or topics (e.g., "biography", "historical events", "nature documentary")
     - **Listicle**: List-based content (e.g., "top 10", "5 best", "7 ways")

     **Priority 3**: If still unclear, default to "short explainer" for general informational content.

   - Topic/Subject: What the video is about. MUST be maximum 5 characters (Chinese) or 5 words (English).

     **CRITICAL**: Extract the topic from the user's original input FIRST, especially if the user provided a script or story. The topic should reflect the actual content the user wants to create a video about (e.g., "Miley Cyrus story", "Hannah Montana casting", "YouTube growth tips"). If the user's original input contains a script or story, summarize the main topic from that script/story. Only use the reasoning text if the original input is unclear.

   - Target audience: Who the video is for. MUST be maximum 5 characters (Chinese) or 5 words (English).

     **CRITICAL**: Extract the target audience from the user's original input FIRST, especially if the user provided a script or story. The target audience should reflect who would be interested in the video content (e.g., "Entertainment fans", "Pop culture enthusiasts", "Aspiring creators"). If the user's original input contains a script or story, infer the target audience from that content. Only use the reasoning text if the original input is unclear.

   - Video & Tone Style: The style and tone of the video. MUST be maximum 5 characters (Chinese) or 5 words (English). You can infer this from both the original input and reasoning text.

   - Overall Steps: High-level 3 workflow steps (e.g., "Craft script → Source visuals → Edit and finalize video"). Use arrow symbols (→) to separate steps.

2. Present the plan in this exact table format (use empty header row, separator line is required):

Love the idea, I'll now plan for creating [choose correct article: "a" or "an"] **[Video Type]** video for you.

CRITICAL: You MUST choose the correct article based on the video type:
- Use "an" before video types starting with a vowel sound: "an explainer", "an educational", "an entertainment", "an overview"
- Use "a" for others: "a tutorial", "a promotional", "a documentary", "a product demo"
- Do NOT output "[a/an]" literally - replace it with the correct article

|  |  |
| --- | --- |
| Topic | [Topic/Subject] |
| Target audience | [Target audience] |
| Video & Tone Style | [Video & Tone Style] |
| Overall Steps | [Overall Steps] |

Starting now! In **~3 min**, you can **preview** or **edit** the script and confirm the voiceover actor.

CRITICAL: The table MUST have exactly this structure:
- First row: Empty header row with "|  |  |" (two empty columns)
- Second row: Separator row with "| --- | --- |" (this is REQUIRED for markdown tables to render correctly)
- Following rows: Data rows with field name in first column and value in second column

Important: Use "an" (not "a") before video types that start with a vowel sound (e.g., "an explainer", "an educational", "an entertainment"). Use "a" for others (e.g., "a tutorial", "a promotional").

Important:
- Replace [Video Type] with the most appropriate video type. Follow the priority rules:
  1. Use the type explicitly mentioned by the user
  2. If not mentioned, carefully analyze the content purpose and choose from: explainer, tutorial, how-to, educational, promotional, product demo, review, news, entertainment, documentary, listicle
  3. Pay attention to keywords: "how to" → tutorial/how-to, "top 10/5/7" → listicle, "review" → review, "explain" → explainer, "learn" → tutorial/educational, "funny/fun" → entertainment
  4. Wrap it with ** to make it bold: **[Video Type]**
- Replace [Topic/Subject] with the actual topic extracted from the user's original input FIRST. If the user provided a script or story, summarize the main topic from that content. MUST be maximum 5 characters (Chinese) or 5 words (English). If longer, truncate or summarize.
- Replace [Target audience] with the target audience extracted from the user's original input FIRST. If the user provided a script or story, infer the target audience from that content. MUST be maximum 5 characters (Chinese) or 5 words (English). If longer, truncate or summarize.
- Replace [Video & Tone Style] with the style and tone. MUST be maximum 5 characters (Chinese) or 5 words (English). If longer, truncate or summarize.
- Replace all other bracketed placeholders with actual content extracted from the user's original input and reasoning text
- Keep the table format clean and concise
- The opening sentence should be: "Love the idea, I'll now plan for creating [a/an] **[Video Type]** video for you." (do not include "about [topic]" in the opening sentence, and make [Video Type] bold)
- Use arrow symbols (→) to separate steps in Overall Steps, not ">" or "-"
- If the topic is unclear from the original input, infer a reasonable topic based on the reasoning text
- Return ONLY the formatted message with the table, no additional explanation

CRITICAL FORMATTING REQUIREMENTS:
- The table MUST be valid markdown table format with proper pipe separators (|)
- Every row MUST start and end with a pipe character (|)
- The separator row MUST be exactly: "| --- | --- |" (with spaces around the dashes)
- DO NOT add any extra text, explanations, or formatting outside the specified format
- The entire output should be copy-paste ready markdown that will render as a table

CRITICAL BOLD FORMATTING FOR FINAL MESSAGE:
- In the final message "Starting now! In ~3 min, you can preview or edit the script and confirm the voiceover actor.", ONLY bold these three words:
  1. The time estimate: **~3 min** (or **~2 min** depending on estimated time)
  2. The word: **preview**
  3. The word: **edit**
- DO NOT bold the entire sentence or any other words
- Correct format: "Starting now! In **~3 min**, you can **preview** or **edit** the script and confirm the voiceover actor."
- Incorrect format: "**Starting now! In ~3 min, you can preview or edit the script and confirm the voiceover actor.**"`,
      {
        userInput: text,
        originalUserInput: originalUserInput || '',
      },
    )
  } else {
    promptText = renderPrompt(
      `You will receive a full reasoning message with multiple paragraphs. The text describes what I plan to do next, but may include too many details or sensitive content.

Your task:
\t1.\tFocus only on the parts in bold.
\t2.\tExtract the essential actions I need to do.
\t3.\tWrite them as up to 3 short sentences, starting with “I'll” (keep the subject).
\t4.\tDo not include technical details, code, file paths, URLs, or sensitive business/legal information.
\t5.\tKeep the output clear, minimal, and action-focused.

Here is the new input:
{{userInput}}`,
      {
        userInput: text,
      },
    )
  }

  try {
    summary = await genMessage(promptText, 'gen-reasoning-summary-chunk')
  } catch (err) {
    logger.error({ error: ensureError(err) }, 'Error generating reasoning summary chunk')
    return null
  }

  if (!summary || summary.trim().length === 0) {
    return null
  }

  return {
    type: 'notifyText',
    text: summary,
  } as NotifyTextStreamPart
}
