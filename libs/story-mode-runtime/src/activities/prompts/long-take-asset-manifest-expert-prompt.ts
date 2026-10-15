import {
  buildLongTakeRoutedPromptTemplate,
  type LongTakePromptRoute,
} from '../../long-take-prompt-router'

interface AssetManifestPromptParams {
  assetIntentNotes?: string[]
  promptRoute?: LongTakePromptRoute
  script: string
  useMinimalAnchorGate?: boolean
  userAssetContext: AssetManifestUserAssetContext
  userSimulationParameters?: string
  voiceCharacter?: null | string
  worldBibleJson?: string
}

type AssetManifestUserAssetContext = {
  characters: unknown[]
  file_understanding?: unknown[]
  files: unknown[]
  objects: unknown[]
}

const USER_ASSET_COMPLETENESS_RULE =
  'User Asset Completeness: You MUST create an asset entry for every user-uploaded file that depicts a character, product, or object. Do NOT omit user files unless they are purely stylistic references (e.g., color palettes, vibe images) that do not appear as physical objects in the narrative.'

const MUSIC_SINGER_ASSET_GUIDANCE =
  'For music-route videos, decide whether an on-screen singer, rapper, artist, or solo performer is appropriate from the user brief, uploaded assets, visual intent, and music-video concept. When the brief, uploaded assets, asset intent, lyrics, or music-video concept calls for a visible singer/rapper/artist or any lip-syncable vocal performance, create a clear singer/rapper Character asset for that performer; prefer asset_id "char_singer" and keyword "The Singer" for a single primary vocalist. Do not create char_singer merely because the route is music, especially when the user asks for scenery, abstract visuals, product/object-centric visuals, lyric-only visuals, or no visible people. If a named artist, rapper, or multiple uploaded main singers need separate recurring anchors, keep their distinct Character assets, but every non-char_singer vocal performer MUST include an explicit singer/rapper/vocal-role token in asset_id itself so downstream lip-sync eligibility can recognize the performer from used_asset_id; use asset_id examples such as char_male_singer, char_female_singer, or char_osa_rapper, and mirror the role in keyword, visual_tag, or visual_reference when helpful. If a user-uploaded character/person image is a suitable singer/artist/performer reference, bind the singer/rapper Character asset to that USER_FILE. Otherwise, when a generated singer is appropriate, generate the singer/rapper Character asset from the Voice Character Analysis when provided, or from explicit visual cues in the user brief, uploaded assets, asset intent, lyrics, and music-video concept when Voice Character Analysis is not provided. When Voice Character Analysis is provided, the singer/rapper Character asset\'s gender presentation and age cues MUST match it. Do not let the singer/rapper anchor replace the narrative cast: still create separate Character assets for recurring on-screen story actors, named people, dancers, love interests, rivals, or other visually recognizable performers that need continuity. Other characters may act in the story, but they are actors, not the singer, and they still need their own anchors when they qualify under the Casting Call rules.'

export function buildLongTakeAssetManifestExpertPrompt(params: AssetManifestPromptParams): string {
  const {
    assetIntentSection,
    script,
    userAssetContext,
    userSimulationParameters,
    voiceCharacterSection,
    worldBibleSection,
  } = formatAssetManifestInputs(params)

  const generalPrompt = buildLegacyAssetManifestPrompt({
    assetIntentSection,
    script,
    userAssetContext,
    userSimulationParameters,
    voiceCharacterSection,
    worldBibleSection,
  })

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute: params.promptRoute,
    templateName: 'asset-manifest',
  })
}

function buildLegacyAssetManifestPrompt(params: {
  assetIntentSection: string
  script: string
  userAssetContext: string
  userSimulationParameters: string
  voiceCharacterSection: string
  worldBibleSection: string
}): string {
  const {
    assetIntentSection,
    script,
    userAssetContext,
    userSimulationParameters,
    voiceCharacterSection,
    worldBibleSection,
  } = params

  return `Role: Production Logistician & Breakdown Artist.

Input: voice_over_script, user_asset_context (if any), user_asset_images (attached as multimodal content, each preceded by a [file_id: ..., filename: ...] label). These bracketed labels are for your internal reference only: NEVER copy [file_id: ...], [filename: ...], or [asset_id: ...] text into any output field — anything echoed into the voice-over will be spoken aloud by TTS.

Objective: Create a strictly utilitarian Asset Manifest. Identify the specific "Nouns" (Cast, Props) required by the script. Do NOT invent visual details, colors, or materials unless explicitly stated in the text or user assets.
IMPORTANT: Every asset in this manifest WILL have a reference image generated. Only include assets that truly need visual consistency across shots. Do NOT include sets, backgrounds, or environments — they are handled separately.
The Breakdown Protocol

Step 1: Visual Consistency Assessment (Asset Qualification)
Scan the script and user assets. For each potential asset, ask: "Does this need to look visually consistent across multiple shots?" Only include assets that answer YES.
Image Understanding: user_asset_context.file_understanding contains per-file visual analysis generated by VLM. Use it when user-provided text description is missing or sparse.
${USER_ASSET_COMPLETENESS_RULE}
User Asset Granularity: Process user_asset_context first. If a file corresponds to a script element or is a core brand asset (Logo/Product), create a distinct Asset ID for it. DO NOT group multiple files into a single "Collection" (e.g., prop_ui_library).
Script-based Assets: Include characters and objects that are visually important to the narrative — i.e., they appear in multiple shots and the viewer needs to recognize them as the same entity. Consider narrative importance over raw mention count.
Always include: The Protagonist, the primary product/object (if the video is product-focused), and any user-uploaded assets.
Do NOT include: Generic background items, abstract concepts, one-off mentions that don't need visual consistency, or items that are only described verbally without visual presence.

Step 2: Build the Asset Manifest
Extract the qualifying nouns and assign them a Stable ID (char_, prop_). Use Simple Logistic Language.
Source Tracking: If an asset is derived from user_asset_context, you MUST add the field "source": "USER_FILE" and provide exactly one valid "source_file_id".
- source_file_id must be selected from user_asset_context.files[].file_id only.
- NEVER invent file IDs.
- If source is not USER_FILE, source_file_id must be null.
Use the user's provided description as the baseline for the visual_reference.
A) The Casting Call (Characters):
Create character assets for any recurring on-screen character that needs visual consistency across multiple shots, including people, animals, pets, mascots, creatures, spokescharacters, or stylized avatars.
Narrator Rule: Do NOT create a character asset for the narrator/voice-over speaker UNLESS the script explicitly describes them appearing on screen (e.g., "I walk into the room", "the host picks up the product"). If the narrator is only a disembodied voice providing commentary, they do NOT need a visual character asset. Many videos (explainers, product demos, educational content) work best without a visible narrator.
Visual Tag: Assign a functional 3-word identifier (e.g., "Male Athletic Runner").
Visual Reference: Describe the Demographics and Physiology only. Do not describe style, lighting, or mood.
Bad: "A glowing cyberpunk hero made of neon data."
Good: "Adult male, 20s, sprinter's build."
Named-Group Expansion (overrides Groups and Crowds below for this case): If the World Bible's key_entities contains a named group with an explicit member roster — pattern "<GroupName> (<Member1>, <Member2>, ...)", e.g., "The Comets (Ava, Bea, Cleo)" — you MUST create ONE separate character asset PER parenthetical member, NOT a single representative. Set each asset's proper_name to that member's name (e.g., "Ava"), give each a distinct asset_id (e.g., char_ava, char_bea, char_cleo), and write each visual_reference to describe that specific individual. This applies even when the script's prose only spells out one member's name and refers to the rest collectively ("the girls", "the trio"); members of an explicit roster must each get their own anchor for visual continuity. The Groups and Crowds rule below applies ONLY to generic groups without an explicit named roster.
Groups and Crowds: Do NOT create group character assets. When the script mentions a crowd or category of people (e.g., "travelers", "protesters"), pick ONE representative individual from the group and create a single-person character asset for them (e.g., char_traveler with visual_reference "Adult female, 30s, carrying a backpack and rolling suitcase"). Anchor images can only depict a single person, so always describe one individual.
Multi-Angle Protocol: If user-provided images show multiple camera angles or views of the exact same character (same person, creature, or stylized figure), you MUST output them as separate, distinct character assets. Append the specific angle to the asset_id (e.g., char_hero_front, char_hero_profile, char_hero_back), the keyword, and the visual_tag. Set "is_multi_angle": true for each of these assets.
${voiceCharacterSection}B) The Prop List (Objects):
Only include Props that need visual consistency across multiple shots. Every Prop listed here will have a reference image generated.
For user-uploaded Props (source: USER_FILE): Always include them.
For script-based Props: Only include objects that are visually important to the narrative and need to be recognized across shots (e.g., a product being demonstrated, a key tool, a recurring symbol). Simple background objects, abstract concepts, or generic items should NOT be listed.
Semantic type preservation: Only promote explicit physical nouns into Props. Do not convert descriptors such as color, lighting, mood, style, material, or genre cues into standalone objects, even when they recur as visual motifs in the World Bible or global constraints.
Visual Reference: Describe the Physical Object only.
Bad: "A mystical glowing artifact pulsing with energy."
Good: "A standard relay baton."
Multi-Angle Protocol: If user-provided images show multiple camera angles or views of the exact same physical object, you MUST output them as separate, distinct assets. Append the specific angle to the asset_id (e.g., prop_tub_front, prop_tub_side), the keyword, and the visual_tag. Set "is_multi_angle": true for each of these assets.
Do NOT include Sets or Environments. Backgrounds and locations are handled separately by the visual script.

${assetIntentSection}User Simulation Parameters:
${userSimulationParameters}

${worldBibleSection}User Asset Context:
${userAssetContext}

Script:
${script}

Output schema:
{
  "asset_manifest": [
    {
      "asset_id": "char_runner",
      "is_multi_angle": "boolean (true if this asset is one angle of a multi-angle set, omit otherwise)",
      "keyword": "The Runner",
      "type": "Character|Prop",
      "source": "USER_FILE|null",
      "source_file_id": "img_xxx|null",
      "proper_name": "string|null",
      "visual_tag": "string",
      "visual_reference": "string"
    }
  ]
}`
}

function formatAssetManifestInputs(params: AssetManifestPromptParams): {
  assetIntentSection: string
  script: string
  userAssetContext: string
  userSimulationParameters: string
  voiceCharacterSection: string
  worldBibleSection: string
} {
  const notes = params.assetIntentNotes?.filter((n) => n.trim().length > 0) ?? []
  const assetIntentSection =
    notes.length > 0
      ? `Asset Intent Notes (HARD CONSTRAINTS — these override filename-based assumptions about what each uploaded file depicts):
${notes.map((n) => `- ${n}`).join('\n')}
When an intent note says "Use Actor image X as Y", the uploaded file depicts Y, not a human actor. You MUST set the Character asset's visual_reference and visual_tag to describe Y. Do NOT create a separate human character for the same file.

`
      : ''

  const trimmedWorldBible = params.worldBibleJson?.trim()
  const worldBibleSection = trimmedWorldBible
    ? `World Bible:
${trimmedWorldBible}

`
    : ''
  const voiceCharacterSection = formatVoiceCharacterSection(params)

  return {
    assetIntentSection,
    script: params.script?.trim() || 'No script provided.',
    userAssetContext: JSON.stringify(
      params.userAssetContext || { characters: [], files: [], objects: [] },
      null,
      2,
    ),
    userSimulationParameters: params.userSimulationParameters?.trim() || 'None',
    voiceCharacterSection,
    worldBibleSection,
  }
}

function formatVoiceCharacterSection(params: AssetManifestPromptParams): string {
  const voiceCharacter = params.voiceCharacter?.trim()

  if (params.promptRoute === 'music') {
    const analysis = voiceCharacter
      ? `Voice Character Analysis: ${voiceCharacter}`
      : 'Voice Character Analysis: Not provided. Use only explicit cues from the user brief, uploaded assets, asset intent, lyrics, and music-video concept as the fallback source for any on-screen singer/rapper appearance.'
    return `${analysis}\n${MUSIC_SINGER_ASSET_GUIDANCE}\n`
  }

  if (!voiceCharacter) {
    return ''
  }

  return `Voice Character Analysis: ${voiceCharacter}\nOnly create a character asset for this voice if the script describes the speaker appearing visually on screen. If the voice is purely narration/commentary with no on-screen presence, they do NOT need a visual character asset. When you DO create an on-screen narrator/voice character, its visual_reference must be consistent with the Voice Character Analysis.\n`
}
