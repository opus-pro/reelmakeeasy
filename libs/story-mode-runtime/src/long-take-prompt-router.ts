export const LONG_TAKE_PROMPT_ROUTES = [
  'abstract',
  'ads-tangible',
  'ads-intangible',
  'general',
  // The LLM route classifier never emits 'music' (it is not described in the classification prompt).
  // A workflow takes this route only once a music beat sheet lands, so music videos get the
  // music-aware visual-script prompt.
  'music',
] as const

export type LongTakeIntentMode = 'ads' | 'explainer' | 'narrative_story'
export type LongTakePromptRoute = (typeof LONG_TAKE_PROMPT_ROUTES)[number]

export type LongTakePromptTemplateName =
  | 'asset-manager'
  | 'asset-manifest'
  | 'beat-sheet'
  | 'keyframe-prompts'
  | 'motion-prompts'
  | 'transition-refinement'
  | 'transition-selection'
  | 'transition-video'
  | 'video-prompts'
  | 'visual-script'
  | 'world-bible'

export type LongTakeTransitionPromptRoute = Extract<
  LongTakePromptRoute,
  'ads-intangible' | 'ads-tangible' | 'music'
>

export function buildLongTakePromptRouteClassificationPrompt(
  confirmedScriptOrTranscript: string,
  originalUserInput?: string,
  options: { intentMode?: LongTakeIntentMode | null } = {},
): string {
  const serializedScript = JSON.stringify(confirmedScriptOrTranscript.trim())
  const serializedOriginalUserInput = originalUserInput?.trim()
    ? JSON.stringify(originalUserInput.trim())
    : ''
  const intentMode = options.intentMode ?? null
  const originalUserInputSection = serializedOriginalUserInput
    ? `
Original user input:
"""${serializedOriginalUserInput}"""
`
    : ''
  const intentModeSection = intentMode
    ? `
Confirmed high-level UIP mode:
"""${intentMode}"""

Treat this mode as a strong intent boundary. It was confirmed upstream with the user before this route classifier runs.
`
    : ''

  return `You are routing a Story Mode video into one of four downstream prompt-template branches.

Classify from the original user input and confirmed script/transcript. Do not use keyword matching. Infer the user's intended video format, visual treatment, and primary purpose.
The confirmed high-level UIP mode, when provided, is the strongest signal for user intent. The confirmed/generated script can clarify the content, but it must not override the user's confirmed mode.

Routes:
- "abstract": Educational or explanatory content whose main subject is a concept, belief, mechanism, system, principle, mental model, cultural pattern, or causal argument, and whose explanation is best served by charts, readable text, formulas, diagrams, bullet points, comparison tables, or other editorial teaching visuals. Use "abstract" only for concept explainer videos that benefit from text/graphic structure. If an abstract or emotional topic is better conveyed through a story rather than editorial teaching visuals, choose "general".
- "ads-tangible": A promotional video that is suitable for the dedicated tangible-ads prompt templates: the user's primary intent is to sell, market, launch, advertise, or drive action for a physical product, venue, retail experience, food/drink, beauty/fashion item, package, device, or other concrete object the viewer can inspect visually. The product or venue should be the hero, with clear audience benefit and commercial/action framing. Do not choose "ads-tangible" merely because a product, logo, outfit, food, car, package, or other physical object appears, because a user uploaded a product-like asset, or because the script uses aspirational/lifestyle brand language. If the user asks for a story, stop-motion video, cinematic/lifestyle scene, music-style montage, character moment, or visual treatment without a clear sell/market/CTA/product-demo purpose, choose "general".
- "ads-intangible": A promotional video that is suitable for the dedicated intangible-ads prompt templates: the user's primary intent is to sell, market, advertise, or drive action for a service, software/app, platform, course, subscription, consulting offer, community, event, or other non-physical offering. The offer should be the hero, with clear value proposition and commercial/action framing. For non-physical offerings, choose this route only when the user asks for, or the script benefits from, a visible product/service surface: app UI, website, dashboard, workflow, booking/signup flow, marketplace listing, form, integration, message flow, service process, before/after result, proof panel, or explicit CTA/end card. For intangible promotions that ask for cinematic, lifestyle, testimonial, creator-led, skit, narrative, motivational, or human-only brand story without a concrete product/demo surface, choose "general".
- "general": Non-promotional content with concrete people, objects, places, events, or actions that can be visualized directly, plus anything that does not fit the other routes. This includes music videos, songs, lyrics, poetry, prayer, multi-person dialogue, conversations, interviews, dialogue scenes, stories, cinematic scenes, film scenes, dramatized visualizations, live-action demonstrations, and concrete room/place/action-based treatments of abstract or emotional topics.

Ads route exclusions:
- Do not choose an ads route just because the content mentions a brand, logo, product, physical object, venue, founder, or company.
- Do not choose an ads route just because a generated script contains a CTA that the user did not request.
- Brand origin stories, founder stories, testimonials, lifestyle stories, stop-motion reveals, product-adjacent storytelling, and cinematic/dramatized scenes should be "general" unless the confirmed high-level UIP mode is "ads".
- If the request would not benefit from the dedicated tangible/intangible ads prompt design, choose "general".

Mode boundary:
- If Confirmed high-level UIP mode is "narrative_story", choose "general". Do not choose "abstract", "ads-tangible", or "ads-intangible".
- If Confirmed high-level UIP mode is "explainer", choose only "abstract" or "general". Do not choose "ads-tangible" or "ads-intangible".
- If Confirmed high-level UIP mode is "ads", choose "ads-tangible" or "ads-intangible" when the request fits the dedicated ads prompt templates above; use the physical-vs-non-physical distinction to decide tangible vs intangible. Otherwise choose "general".

Decision order:
1. If the primary format is music, lyrics, poetry, prayer, or multi-person dialogue/conversation/interview, choose "general".
2. Apply the Mode boundary rules above when a confirmed high-level mode is provided.
3. If Confirmed high-level UIP mode is "ads" and the request fits the dedicated ads prompt templates, choose the relevant ads route.
4. If the original user intent calls for story/scene/cinematic/dramatized/live-action/concrete visual treatment, choose "general" even when the topic is abstract or brand/product-adjacent.
5. If the core content is best explained through charts, readable text, formulas, diagrams, bullet points, comparison tables, or other editorial teaching visuals, choose "abstract".
6. Otherwise choose "general".

Return JSON with:
- "prompt_route": exactly one of "abstract", "ads-tangible", "ads-intangible", "general"
- "reasoning": one concise sentence explaining the primary reason

Confirmed script/transcript:
"""${serializedScript}"""
${intentModeSection}
${originalUserInputSection}`
}

export function buildLongTakeRoutedPromptTemplate(params: {
  generalPrompt: string
  promptRoute?: LongTakePromptRoute
  templateName: LongTakePromptTemplateName
}): string {
  const { generalPrompt } = params
  return generalPrompt
}

export function isAdsPromptRoute(
  route: LongTakePromptRoute,
): route is Extract<LongTakePromptRoute, 'ads-intangible' | 'ads-tangible'> {
  return route === 'ads-tangible' || route === 'ads-intangible'
}

export function resolveLongTakeTransitionPromptRoute(
  promptRoute?: LongTakePromptRoute,
): LongTakeTransitionPromptRoute | undefined {
  return promptRoute === 'ads-tangible' ||
    promptRoute === 'ads-intangible' ||
    promptRoute === 'music'
    ? promptRoute
    : undefined
}
