import {
  buildLongTakeRoutedPromptTemplate,
  type LongTakePromptRoute,
} from '../../long-take-prompt-router'

interface KeyframePromptsFromVisualScriptParams {
  /**
   * What each bound anchor actually looks like, keyed by the `anchor_id` the
   * visual script binds under `used_asset_id`. Absent on projects
   * with no UIP stage.
   */
  anchorDescriptions?: Record<string, string>
  fullStyleText?: string
  /**
   * `global_constraints.json`, read for the rules that used to be appended after
   * the fact: the named entities, where and when the story sits, the script's
   * language. Only needed once the rework is on.
   */
  keyframeGlobalContext?: null | {
    brandScope?: string
    geoScope?: string
    keyEntities?: string[]
    scriptLanguage?: string
    timeScope?: string
  }
  /**
   * The keyframe meta-prompt rework. False is
   * today's prompt, byte for byte: no writing order, the original word ceiling,
   * and no anchor descriptions even when the caller supplies them.
   */
  keyframePromptReworkEnabled?: boolean
  /**
   * Story Mode 3.0. Under that contract `core_description` is the
   * WHOLE clip written in time order, not a still, so the keyframe must be its
   * opening instant. Default false keeps every V2 caller byte-identical.
   */
  openingInstantOnly?: boolean
  promptRoute?: LongTakePromptRoute
  visualScriptJson: string
}

export function buildLongTakeKeyframePromptsFromVisualScriptPrompt(
  params: KeyframePromptsFromVisualScriptParams,
): string {
  const visualScriptJson = params.visualScriptJson?.trim() || '[]'
  // Stylization filter: author each shot's prompt_base by REWRITING
  // its short description THROUGH the rich STYLE GUIDE -- describing the scene
  // as richly as the guide allows so it renders in that style, never by pasting
  // the guide text. Consumes whatever richness fullStyleText carries (thin
  // preset text today, the full style guide once it is plumbed in). Empty ->
  // '' (no-op).
  // Story Mode 3.0 authors a shot as one continuous take written in time order,
  // so the description names things that happen AFTER the frame we need. Without
  // this the model composites the whole span into one image -- a subject in two
  // places, or the end state drawn as the opening.
  const openingInstantBlock = params.openingInstantOnly
    ? `

Opening Instant (CRITICAL -- overrides how you read every description below):
Each shot's description covers the WHOLE clip, written in time order. Draw ONLY its FIRST INSTANT: the composition the shot opens on, before the action develops.
- Everything after the opening beat is context for framing, lighting, and subject identity -- never content to depict. If the description says a character crosses a room and opens a door, draw the character at the start of that crossing, not at the door.
- The action is already underway at this instant. This is a frame lifted from a moving shot, not a posed tableau: keep the subject mid-motion, weight shifted, expression live.
- One moment, one place. Never composite two points in time into one frame, and never add a second instance of a subject to show progression.
- Do not draw motion trails, arrows, multiple exposures, before/after panels, or any other device that depicts elapsed time.`
    : ''
  const style = params.fullStyleText?.trim()
  const styleBlock = style
    ? `

Stylization (CRITICAL -- applies to EVERY shot's prompt_base):
Treat the STYLE GUIDE below as the rich reference for HOW everything looks. For each shot, REWRITE its short description by filtering it THROUGH the guide: re-describe the shot's subject, action, and setting as richly and concretely as the guide allows so the frame renders in that exact style. The prompt_base is an authored, fully-specified image prompt -- never the original text with the style stapled on.

Mesh, never paste: never copy, restate, or append the guide's wording; never repeat the same style sentence across shots; never tack on "in X style" as a label. Pull the SPECIFIC look the guide describes (rendering technique and medium, materials and surface treatment, line/edge/shadow logic, how faces and figures are constructed, texture, level of stylization, color blocking) and apply it to THIS shot's concrete elements.

Add concrete, renderable detail the bare description lacks: how each surface and subject is drawn under the guide's rules, how light and shadow fall in THIS scene, what the shapes and forms look like. Every prompt_base must read differently and stay specific to its shot.

Keep each shot's OWN setting, time-of-day, and lighting (a midnight scene stays dark; a lit scene stays lit). Apply only the style's transferable LOOK -- never import the guide's own example scene, mood, or time-of-day when it conflicts with the shot.

Palette: use ONLY the guide's colors, by their exact names and hex (e.g. "deep teal color (#2A7B6F)"). Per shot, place the palette colors on the elements they belong to (lit surfaces, shadows, key objects) following the guide's color logic; do not force every color into every frame, and never invent off-palette colors.

Consistency: you can see ALL shots -- apply the same technique, materials, palette logic, and stylization level across every prompt_base so they read as one visual world, but express it freshly per shot.

STYLE GUIDE (the rich reference to render every shot in -- draw FROM it, never copy it into the output):
${style}`
    : ''

  // Richness amplifier (general route only, style-gated): the meshing rules
  // above stop pasting but leave prompts thin -- the model tends to keep the
  // ~45-word visual_script description near-verbatim and stamp a generic style
  // summary on the end. This pushes each prompt_base to a fully-integrated,
  // paintable spec by (1) treating the shot text as a skeleton to expand
  // element by element, (2) a per-shot dimension checklist, (3) a richness
  // floor, and (4) banning the trailing generic style-summary sentence so the
  // style is woven through the elements instead. No worked example, to avoid
  // seeding its content/palette. Empty when no style guide is present so
  // no-style / preset shots stay lean.
  const richnessBlock = style
    ? `

Richness (author EVERY prompt_base to this level while a STYLE GUIDE is present):
Treat the shot's description as a SKELETON to flesh out, not near-final text to lightly decorate. Expand it into a fully-specified image prompt a person could paint from: name each element the shot contains and render it under the guide's rules, so detail accrues element by element. Work through these dimensions -- only where the shot actually contains them:
- Subject(s): what each key subject looks like AND how it is drawn under the guide's rules -- materials, surface treatment, linework/edges, shading model.
- Faces and figures (character shots): how they are constructed per the guide (proportions, facial planes, features) -- never a bare "a person".
- Environment / background: how the setting and its surfaces are rendered, not merely named.
- Light and shadow in THIS scene: where light comes from, how shadows fall and are shaped under the guide's logic.
- Texture and stylization level, plus palette placement by exact name and hex on the elements each color belongs to.
Weave the style through the elements; never summarize it. Apply the guide's rules ON each named subject, surface, and background as you describe them, so the look emerges from the concrete elements. Do NOT append a generic style-summary sentence that restates the guide's overall look (a trailing "the whole scene is rendered in <the guide's style> with <its global rules>" line is banned) -- the style must show only through how the elements are rendered.
Aim for a dense, concrete prompt (roughly ${params.keyframePromptReworkEnabled ? '250-400' : '70-110'} words) built ENTIRELY from real, shot-specific detail. Never pad with generic filler, and never restate the guide verbatim to reach length (see Mesh, never paste).`
    : ''

  // The shape of a finished prompt_base.
  //
  // Split in two on purpose. Four of the six beats -- the moment, the light, the
  // framing, what must not appear -- say nothing about style, and the measured
  // defect is two of those: shipped prompts state the framing in 1 of 15 shots
  // and state what must not appear in 0 of 15. Gating the whole order behind a
  // style guide withheld that fix from every project without a
  // `style_source.json`, for a reason that had nothing to do with the defect.
  //
  // (An earlier version of this comment claimed presets were most of production
  // and therefore most of the withheld set. That came from one project read
  // wrongly and is not something this codebase can tell you. The beats are
  // un-gated because they are not about style, which stands on its own.)
  //
  // So the beats ship whenever the rework is on, and the parts that genuinely
  // need a guide to mean anything -- attaching the style as the subject is
  // introduced, placing the palette on real objects, the deletion test -- ride
  // `style` like the blocks around them. No worked example, for the reason
  // richnessBlock gives: it seeds its own content and palette into unrelated
  // projects.
  const writingOrderBlock = params.keyframePromptReworkEnabled
    ? `

Writing order (author EVERY prompt_base this way):
Write each prompt_base as ONE continuous paragraph. No section labels, no headings,
no lists, no preamble. It reads as description, not as a form.

Write it in this order:

1. The subject, from its anchor description where it has one.
2. The single moment. What is happening at this instant, and the physical detail that
   fixes it in time.
3. The place, and the things that fill it, named as real objects rather than listed.
4. The light. Where the single source sits, how it falls on the subject, what the
   shadows do.
5. The framing. How close, from what height, what is sharp and what softens.
6. What must not appear. Only what this shot needs.

Open every shot with a subject and a verb. A long subject description that never reaches
a verb is a fragment. Introduce the subject doing something, then describe how it is
drawn in its own sentence.`
    : ''

  // The half of the order that a style guide has to be present for. Beat numbers
  // refer to the block above, which is always there when this one is.
  const writingOrderStyleBlock =
    style && params.keyframePromptReworkEnabled
      ? `

Using the style guide, inside that order:

The style guide never overrides the shot. Where the shot specifies something about a
subject -- a colour, a feature, a piece of clothing -- and the style guide says
otherwise, the shot wins. Everything the guide says that the shot did not contradict,
use as written, including anything it says about how figures are built.

Ignore only the guide's mood, its stated intent, and any example scene it describes.
The shot supplies those.

At beat 1, attach the style as you introduce the subject. Do not name the style and then
describe the subject -- say what the subject is made of, how its surfaces are finished,
how its edges and shadows are treated, using the style guide's own terms, in the same
breath as naming it.

At beat 3, assign the palette to the things in the place. The style guide's colours --
and their proportions where it gives them -- become named objects: the colour that
carries most of the frame goes on the largest surfaces, the smallest accent goes on one
small object. Never list the colours. Put each one on something.
If the style guide gives a colour an exact value, carry that value with it, in
parentheses, on the object it lands on -- "open, cool shadow across her front in
dark slate blue (#2C3545)". The value is part of the colour's name, not a
separate instruction. Never state a value on its own, and never invent one for a
colour the style guide left unvalued.

Never write the style as its own sentence. It reaches the frame only through the
surfaces, materials, colours and light of the things you are describing.

Test it by deletion. Take out every style phrase -- every material, finish, colour value,
edge and light-quality word -- and what is left must still read as a complete scene:
whole sentences, each with a verb, saying who is there, what they are doing, where they
are, how it is lit and how it is framed. If a sentence collapses into a list of nouns
when the style comes out, the style was doing the scene's work. Write the scene first so
it stands on its own, then braid the style through it.

Every shot in this video shares that world: the same materials, the same colours on the
same kinds of surface, the same quality of light. When a later shot returns to a place
already described, describe it again in the same terms rather than referring back to it.`
      : ''

  // The rules code used to staple onto every finished prompt, moved here so the
  // author writes them into the scene instead.
  //
  // They were word-for-word identical on every shot of a video and ran 1,321 to
  // 2,844 characters -- up to 57% of what the image model read. Stated once to
  // the author, they become part of one described scene; stated per shot to the
  // image model, they are the same paragraph twenty times.
  //
  // What did NOT move, and why: the typography directive is chosen per shot by
  // `Math.random()` in code, so an author cannot reproduce the draw; and the
  // anti-cloning and brand-product clauses address how the image model should
  // treat its reference images, which the author never sees.
  const worldRulesBlock = buildKeyframeWorldRulesBlock(params)

  // The descriptions the anchor reference images were generated from.
  //
  // This call has never had them. It receives the visual script, whose own
  // wording is a paraphrase written by a different model -- on the project this
  // was measured against, a character whose anchor specifies a bolero jacket, two
  // bows, a pleated skirt, stockings and boots reaches this call as "a white and
  // lavender dress", a garment she does not wear. The image model is then handed
  // a reference image of one person and a prompt describing another, and has to
  // choose. Naming the same subject in both is what stops it choosing.
  //
  const anchorEntries = Object.entries(params.anchorDescriptions ?? {}).filter(
    ([assetId, description]) => assetId.trim() && description.trim(),
  )
  const anchorLines = anchorEntries
    .map(([assetId, description]) => `- ${assetId}: ${description.trim()}`)
    .join('\n')
  // NOT style-gated, unlike every other block in this file. Those exist to mesh a
  // style guide through the shot and are meaningless without one. This one says
  // who the subject is, which a project with no style guide -- or a preset one,
  // which `isStylizableStyleRef` withholds `style_source.json` from -- gets
  // wrong in exactly the same way. Gating it on style would have hidden the fix
  // from the projects that need it just as much.
  const anchorBlock =
    params.keyframePromptReworkEnabled && anchorEntries.length > 0
      ? `

ANCHOR DESCRIPTIONS (the authoritative account of each bound subject -- keyed by the asset_id the shot binds in used_asset_id):
${anchorLines}`
      : ''

  // The rule that makes the block above usable. Without it the descriptions are
  // just more context the model may or may not draw on; the point is that they
  // OUTRANK the shot's own wording about the subject.
  const anchorRule = anchorBlock
    ? `

The subject comes from its anchor:
Every character and named prop in a shot has an anchor -- a reference image generated before any keyframe, from its own written description, listed under ANCHOR DESCRIPTIONS below. That description is the only authoritative account of what the subject looks like, and the reference image every keyframe is conditioned on was made from it.
Use it verbatim for the subject: skin, hair, eyes, build, every garment and its colour, a prop's material and parts. Do not summarise it, do not substitute a shorter phrase, and do not let the shot's own wording override it -- a shot that says "her white and lavender dress" where the anchor says "a black bolero-style jacket with wide sleeves over a white top with a large purple bow at the neck" is a lossy summary, and following it puts the text in conflict with the image the model is looking at.
Carry it in every shot that binds that asset_id, including close-ups. When the text and the reference image describe the same person, the model stops choosing between them.`
    : ''

  if (
    params.promptRoute === 'abstract' ||
    params.promptRoute === 'ads-tangible' ||
    params.promptRoute === 'ads-intangible'
  ) {
    return buildTextFriendlyLongTakeKeyframePromptsFromVisualScriptPrompt({
      // These routes take the identity rule but not the writing order: an ads or
      // abstract keyframe is deliberately concise, and getting the product or
      // person wrong is worse there than anywhere -- a tangible ad IS the
      // product.
      anchorBlock,
      anchorRule,
      worldRulesBlock,
      openingInstantBlock,
      promptRoute: params.promptRoute,
      styleBlock,
      visualScriptJson,
    })
  }

  const generalPrompt = `Role: Image Prompt Architect.

Task:
You are given one visual_script JSON array. Produce one keyframe prompt (prompt_base) per shot. Build each prompt_base from that shot's description: clean it (below), then -- when a STYLE GUIDE is present below -- author it into a dense, fully-specified image prompt in that style (see Stylization and Richness), not a one-line summary. Preserve everything the shot must show (subject, action, setting, framing, moment); never drop or change its content.${openingInstantBlock}

Content cleaning (always apply):
- ID Humanization (CRITICAL): the description often contains technical IDs (e.g. prop_dashboard, char_user, set_workspace). Convert them to natural language -- drop the prefix (prop_, char_, set_) and replace underscores with spaces. Example: "...scans the sidebar of prop_dashboard..." -> "...scans the sidebar of dashboard...".
- Remove strings like (User Asset) or (User File).
- Incidental Text Removal: rewrite instructions that would produce small, scattered, or annotation-style text into visual equivalents:
  - Parenthetical stage directions like "(DIMMED)", "(LOCKED)", "(HIGHLIGHTED)" -- describe the state visually instead.
  - Small floating labels, geographic captions, corner date stamps, map annotations -- replace with a color wash, shading, or silhouette.
  - Directory listings or tables that spell out entity names as readable rows -- replace with abstract marks, icons, or blurred impressions.
  - Exception: keep typography where the shot frames text as the primary focal element (e.g. a large stamped headline, a single bold word dominating the frame).

Product Fidelity Rule (CRITICAL):
If an uploaded user asset is a real product, packaging, logo, or branded object, preserve it exactly -- do NOT rearrange text, change label layout, invent new graphics or emphasis, or recreate/approximate the design. The style must NOT change the product itself.

Set Signal (Visual Cue):
Check used_asset_id for Set suffixes to reinforce the background plate selection.
IF _wide is found: append " Establishing shot context" (note the leading space).
IF _reverse is found: append " Depth detail context".
ELSE: append nothing.

Punctuation: remove the final period at the very end of the prompt_base so it flows smoothly.
${styleBlock}${richnessBlock}${writingOrderBlock}${writingOrderStyleBlock}${anchorRule}${anchorBlock}${worldRulesBlock}

Output schema:
{
  "shots": [
    {
      "shot_id": "string",
      "prompt_base": "string"
    }
  ]
}

Output constraints:
- Return valid JSON only.
- No markdown fences.
- No extra commentary.
- Keep shot_id exactly the same as input shot_id.
- Keep the number of output shots equal to input visual_script length.

visual_script.json:
${visualScriptJson}`

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute: params.promptRoute,
    templateName: 'keyframe-prompts',
  })
}

/**
 * The rules code used to staple onto every finished prompt, moved into the
 * authoring prompt so the author writes them into the scene instead.
 *
 * They were word-for-word identical on every shot of a video and ran 1,321 to
 * 2,844 characters -- up to 57% of what the image model read. Stated once to the
 * author they become part of one described scene; stated per shot to the image
 * model they are the same paragraph twenty times.
 *
 * What did NOT move, and why: the typography directive is drawn per shot by
 * `Math.random()` in code, so an author cannot reproduce the draw; and the
 * anti-cloning and brand-product clauses are about how the image model should
 * treat a reference image, which the author never sees.
 */
function buildKeyframeWorldRulesBlock(params: KeyframePromptsFromVisualScriptParams): string {
  if (!params.keyframePromptReworkEnabled) {
    return ''
  }
  const gc = params.keyframeGlobalContext
  const rules = [
    gc?.keyEntities?.length
      ? `- Named entities in this story: ${gc.keyEntities.join(', ')}. Render only the ones this shot calls for, and keep each one's visual identity the same wherever it appears.`
      : '',
    gc?.keyEntities?.length
      ? '- Never invent, redraw or restyle a brand logo, wordmark or brand-name lockup. Describe a brand mark only when a reference image for this shot supplies it; otherwise keep brand names out of the frame entirely rather than writing one in as a logo or lockup.'
      : '',
    gc?.geoScope
      ? `- The story sits in ${gc.geoScope}. Evoke it through the environment, never through captions or labels.`
      : '',
    gc?.timeScope
      ? `- The period is ${gc.timeScope}. Convey it through visual style, never through a date stamp.`
      : '',
    '- No incidental text: no corner date stamps, map annotations, geographic captions or floating entity labels, unless the shot itself makes typography a dominant visual element.',
    '- One cohesive scene filling the frame. Never describe a grid, collage, split-screen, multi-panel layout or repeated variations; a reference image supplies identity, not layout.',
  ].filter(Boolean)

  return `

Constraints on every prompt_base (these used to be appended after you; they are yours now):
${rules.join('\n')}`
}

function buildTextFriendlyLongTakeKeyframePromptsFromVisualScriptPrompt(params: {
  anchorBlock: string
  anchorRule: string
  openingInstantBlock: string
  promptRoute: Extract<LongTakePromptRoute, 'abstract' | 'ads-intangible' | 'ads-tangible'>
  styleBlock: string
  visualScriptJson: string
  worldRulesBlock: string
}): string {
  const routeGuidance = buildTextFriendlyRouteGuidance(params.promptRoute)

  return `Role: Text-Friendly Image Prompt Architect.

Task:
You are given one visual_script JSON array. Generate one keyframe prompt base per shot.

Core Rule:
Use each shot's visual.core_description as the source of truth. Keep the prompt concise, concrete, and directly renderable.${params.openingInstantBlock}

Classic Route Keyframe Preservation Guidance:
${routeGuidance}

Text Policy:
- Do not remove text that the shot intentionally asks to be visible.
- Keep quoted visible text exactly as written.
- Do not add random filler text, fake tiny paragraphs, gibberish UI rows, or unsupported claims.
- If text is not requested by the shot, do not add extra text.

Sanitization:
- Remove internal technical IDs such as prop_dashboard, char_user, set_workspace by converting them into natural language.
- Remove bracketed/internal markers such as [asset_id: ...], [file_id: ...], [filename: ...], (User Asset), or (User File).
- Keep real brand/product/service/UI names when they are part of the visible scene.
- Remove the final period at the very end of the prompt_base if present.

Product/Brand Fidelity:
- If an uploaded user asset is a logo, UI screenshot, website, product, packaging, or branded object, preserve its design exactly when the shot uses it.
- Do not rearrange logo text, rewrite UI copy, redesign packaging, or invent new brand marks.
${params.styleBlock}${params.anchorRule}${params.anchorBlock}${params.worldRulesBlock}

Output schema:
{
  "shots": [
    {
      "shot_id": "string",
      "prompt_base": "string"
    }
  ]
}

Output constraints:
- Return valid JSON only.
- No markdown fences.
- No extra commentary.
- Keep shot_id exactly the same as input shot_id.
- Keep the number of output shots equal to input visual_script length.

visual_script.json:
${params.visualScriptJson}`
}

function buildTextFriendlyRouteGuidance(
  promptRoute: Extract<LongTakePromptRoute, 'abstract' | 'ads-intangible' | 'ads-tangible'>,
): string {
  if (promptRoute === 'abstract') {
    return `Abstract explainer route:
- Preserve intentional labels, numbers, comparison text, chart text, screenshots, large claims, arrows, and callouts that make the concept easier to understand.
- Keep the frame simple, legible, and editorial: large readable type, simple shapes, cards, grids, paper, whiteboards, charts, counters, timelines, comparison tables, screenshots, article panels, or document panels.
- Do not replace clear claims with elaborate cinematic metaphor, symbolic hero journeys, or extra decorative props.
- Do not literalize idioms or emotional metaphors as physical objects unless the script explicitly requires the physical meaning.
- Keep motion implications simple and renderable: reveal, slide, highlight, circle, underline, cross out, count up, stack, sort, or compare side by side.`
  }

  if (promptRoute === 'ads-tangible') {
    return `Tangible product ad route:
- Preserve intentional brand names, product names, packaging text, logo/wordmark text, feature callouts, proof labels, offer text, and CTA text.
- Keep the physical product as the main visual anchor: product reveal, product close-up, packaging shot, hands-on demo, feature callout, before/after, proof moment, offer, or supported CTA/end card.
- If a reference image is attached for a product, packaging, logo, creator, or influencer, preserve the visible identity details and do not redesign them.
- Do not invent unsupported prices, discounts, claims, certifications, phone numbers, guarantees, or generic CTA copy.
- Avoid turning the product moment into a poster layout, generic explainer, abstract metaphor, or unrelated lifestyle scene.`
  }

  return `Intangible product ad route:
- Preserve intentional brand names, logo/wordmark text, website/app UI strings, dashboard/listing text, workflow labels, integration names, proof labels, offer text, and CTA text.
- Keep the brand and product experience as the visual anchors: website/app screen, dashboard view, scrolling page, listing grid, form fill, message/email flow, workflow map, integration icons, before/after result, proof moment, customer/creator example, offer, or supported CTA/end card.
- If no real UI is referenced, render a simplified believable interface with only 1-3 readable labels or fields from the shot. Do not create dense fake UI rows or tiny invented text.
- If a reference image is attached for UI, website, logo, creator, influencer, or customer example, preserve the visible identity details and do not redesign them.
- Do not invent unsupported prices, discounts, claims, certifications, phone numbers, guarantees, exact UI details, or generic CTA copy.
- Avoid turning the product experience into a generic explainer, abstract metaphor, unrelated lifestyle scene, or sterile software screenshot with no ad payoff.`
}
