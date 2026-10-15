export function buildAbstractLongTakeVisualScriptPrompt(params: {
  allowedAssetIds: string
  assetManifestJson: string
  beatSheetJson: string
  globalConstraintsJson: string
  mandatoryUserUploadBindingSection: string
  perfectLoop: boolean
  script: string
  userAssetContentJson: string
  worldBibleJson: string
}): string {
  const {
    allowedAssetIds,
    assetManifestJson,
    beatSheetJson,
    globalConstraintsJson,
    mandatoryUserUploadBindingSection,
    perfectLoop,
    script,
    userAssetContentJson,
    worldBibleJson,
  } = params

  return `Abstract Explainer Visual Contract

Role:
You are an editorial visual designer for abstract explainer videos.

Goal:
Create one clear visual per beat that helps the viewer understand the argument faster.

Core Rules:
- Prioritize argument clarity over cinematic style.
- Do not make the video pure text; use visual structure to explain the idea.
- If the script names a concept, belief, number, contrast, claim, process, or misconception, keep it visible through readable text or simple graphics.
- Use text and numbers boldly when they carry meaning.
- Important numbers must appear as large readable numbers, counters, charts, timelines, or side-by-side comparisons.
- Avoid over-designed symbolism and vague metaphor.
- Use simple scenes when they help explain the idea.
- Each shot should express one primary idea and be readable at a glance.
- Keep motion simple: reveal, slide, highlight, circle, underline, cross out, count up, stack, sort, or compare.

Position Rules:
${perfectLoop ? '- Perfect loop mode: provide entry_action and exit_action when they help the loop return to the opening visual.' : '- Non-loop mode: first shot entry_action should be null; last shot exit_action should be null.'}

Critical Hard Constraints:
1. Beat lock:
- Create exactly one shot per beat.
- Output shot count must equal beat_sheet length.
- Shot order must match beat order.

2. Shot ID:
- shot_id must be exactly String(beat_id).

3. Audio:
- audio must follow the corresponding beat segment_text verbatim.
- Do not paraphrase, rewrite, reorder, or add words.

4. Asset binding:
- Each shot must include used_asset_id: string[].
- used_asset_id may only contain IDs from the Allowed Asset IDs list below.
- If a shot depicts a recognizable character/object from the asset manifest, include its asset ID.
- If no relevant asset is needed, output [].
${mandatoryUserUploadBindingSection}

5. Visual:
- visual.core_description is the keyframe source of truth. Make it concise, readable, and specific.
- visual.entry_action and visual.exit_action can be null for static editorial frames.
- Do not use montage language or editing instructions.

6. Output:
- Return JSON object only, with a top-level "shots" array.
- No markdown fences.
- No extra commentary.

Output item schema:
{
  "shots": [
    {
      "shot_id": "1",
      "audio": "string",
      "used_asset_id": ["char_x", "prop_y"],
      "visual": {
        "core_description": "string",
        "entry_action": "string|null",
        "exit_action": "string|null"
      }
    }
  ]
}

Allowed Asset IDs:
${allowedAssetIds}

Script:
${script}

Beat Sheet JSON:
${beatSheetJson}

Asset Manifest JSON:
${assetManifestJson}

World Bible JSON:
${worldBibleJson}

User Asset Content JSON:
${userAssetContentJson}

Global Constraints JSON:
${globalConstraintsJson}
`
}

export function buildAdsIntangibleLongTakeVisualScriptPrompt(params: {
  allowedAssetIds: string
  assetManifestJson: string
  beatSheetJson: string
  globalConstraintsJson: string
  mandatoryUserUploadBindingSection: string
  perfectLoop: boolean
  script: string
  userAssetContentJson: string
  worldBibleJson: string
}): string {
  const {
    allowedAssetIds,
    assetManifestJson,
    beatSheetJson,
    globalConstraintsJson,
    mandatoryUserUploadBindingSection,
    perfectLoop,
    script,
    userAssetContentJson,
    worldBibleJson,
  } = params

  return `Intangible Ad Visual Contract

Role:
You are a visual director for short-form ads for services, software, platforms, apps, agencies, marketplaces, or brand offers.

Goal:
Create one clear ad shot per beat. The viewer should understand what the offer is, how it works, why it matters, and what action to take.

Core Rules:
- The brand, product experience, service workflow, or customer result must be the visual anchor.
- Prefer demo-first visuals: UI, website, workflow, message thread, listing, form, dashboard, integration, customer example, before/after result, proof moment, offer, or CTA.
- Do not make generic lifestyle scenes replace the product experience.
- Do not make the whole ad sterile dashboards. Alternate product surfaces with human outcome, customer example, before/after proof, creator moment, or brand-memory shot when the beat supports it.
- Use human/customer scenes when they clarify the problem, outcome, trust, or emotional benefit.
- If no real UI/logo asset is uploaded, create a simplified brand-labeled UI mockup only from details supported by the script or assets, with 1-3 large readable labels or fields instead of dense fake interface text.
- For benefit/proof beats, include a customer outcome or service result motif rather than only showing abstract software chrome.
- Do not invent prices, discounts, guarantees, certifications, metrics, phone numbers, URLs, or unsupported product features.
- Keep a consistent brand system across shots.
- Each shot should have one ad function: hook, problem/desire, offer reveal, workflow/demo, benefit, proof, offer, CTA, or brand hold.
- The final shot should show CTA only when the script explicitly includes or clearly implies one; otherwise end on brand/product/benefit.
- Keep visual prose in English.
- Any visible on-screen text must match the language of the voice-over and be wrapped in single quotes.
- Do not describe montage language or editing cuts.
Position Rules:
${perfectLoop ? '- Perfect loop mode: provide entry_action and exit_action when they help the loop return to the opening visual.' : '- Non-loop mode: first shot entry_action should be null; last shot exit_action should be null.'}
Critical Hard Constraints:
1. Beat lock:
- Output shot count must equal beat_sheet length.
- Shot order must match beat order.
2. Shot ID:
- shot_id must be exactly String(beat_id).
3. Audio:
- audio must follow the corresponding beat segment_text verbatim.
- Do not paraphrase, rewrite, reorder, or add words.
4. Asset binding:
- Each shot must include used_asset_id: string[].
- used_asset_id may only contain IDs from the Allowed Asset IDs list below.
- If a shot depicts a recognizable brand, logo, UI, website/app screen, creator/influencer, character, object, or uploaded example from the asset manifest, include its asset ID.
- If no relevant asset is needed, output [].
${mandatoryUserUploadBindingSection}
5. Visual:
- visual.core_description is the keyframe source of truth. Make it concrete, brand/UI/workflow-focused, and specific.
- visual.entry_action and visual.exit_action can be null for static UI holds or end cards.
- Do not use montage language or editing instructions.
6. Output:
- Return JSON object only, with a top-level "shots" array.
- No markdown fences.
- No extra commentary.
Output item schema:
{
  "shots": [
    {
      "shot_id": "1",
      "audio": "string",
      "used_asset_id": ["char_x", "prop_y"],
      "visual": {
        "core_description": "string",
        "entry_action": "string|null",
        "exit_action": "string|null"
      }
    }
  ]
}
Allowed Asset IDs:
${allowedAssetIds}
Script:
${script}
Beat Sheet JSON:
${beatSheetJson}
Asset Manifest JSON:
${assetManifestJson}
World Bible JSON:
${worldBibleJson}
User Asset Content JSON:
${userAssetContentJson}
Global Constraints JSON:
${globalConstraintsJson}
`
}

export function buildAdsTangibleLongTakeVisualScriptPrompt(params: {
  allowedAssetIds: string
  assetManifestJson: string
  beatSheetJson: string
  globalConstraintsJson: string
  mandatoryUserUploadBindingSection: string
  perfectLoop: boolean
  script: string
  userAssetContentJson: string
  worldBibleJson: string
}): string {
  const {
    allowedAssetIds,
    assetManifestJson,
    beatSheetJson,
    globalConstraintsJson,
    mandatoryUserUploadBindingSection,
    perfectLoop,
    script,
    userAssetContentJson,
    worldBibleJson,
  } = params

  return `Tangible Product Ad Visual Contract

Role:
You are a visual director for short-form ads for physical products.

Goal:
Create one clear ad shot per beat. The viewer should understand what the product is, what it does, why it matters, and what action to take.

Core Rules:
- The physical product must be the primary visual anchor in most shots.
- Show the actual product, packaging, logo, material, scale, hands-on use, feature detail, before/after result, proof moment, offer, or CTA.
- If product assets are uploaded, preserve their exact appearance: shape, color, material, logo, packaging, labels, and proportions.
- Use human/customer scenes when they show product use, problem, outcome, trust, or emotional benefit.
- If no product/logo asset is uploaded, create only a simple product mockup based on details supported by the script or assets.
- Do not invent prices, discounts, guarantees, certifications, ratings, claims, ingredients, specs, flavors, models, or packaging text.
- Keep the product design and brand system consistent across shots.
- Each shot should have one ad function: hook, problem/desire, product reveal, demo/use, feature, benefit, proof, offer, CTA, or product/brand hold.
- The final shot should show CTA only when the script explicitly includes or clearly implies one; otherwise end on product/brand/benefit.
- Keep visual prose in English.
- Any visible on-screen text must match the language of the voice-over and be wrapped in single quotes.
- Do not describe montage language or editing cuts.
Position Rules:
${perfectLoop ? '- Perfect loop mode: provide entry_action and exit_action when they help the loop return to the opening visual.' : '- Non-loop mode: first shot entry_action should be null; last shot exit_action should be null.'}
Critical Hard Constraints:
1. Beat lock:
- Output shot count must equal beat_sheet length.
- Shot order must match beat order.
2. Shot ID:
- shot_id must be exactly String(beat_id).
3. Audio:
- audio must follow the corresponding beat segment_text verbatim.
- Do not paraphrase, rewrite, reorder, or add words.
4. Asset binding:
- Each shot must include used_asset_id: string[].
- used_asset_id may only contain IDs from the Allowed Asset IDs list below.
- If a shot depicts a recognizable character/object from the asset manifest, include its asset ID.
- If no relevant asset is needed, output [].
${mandatoryUserUploadBindingSection}
5. Visual:
- visual.core_description is the keyframe source of truth. Make it concrete, product-focused, and specific.
- visual.entry_action and visual.exit_action can be null for static product holds or end cards.
- Do not use montage language or editing instructions.
6. Output:
- Return JSON object only, with a top-level "shots" array.
- No markdown fences.
- No extra commentary.
Output item schema:
{
  "shots": [
    {
      "shot_id": "1",
      "audio": "string",
      "used_asset_id": ["char_x", "prop_y"],
      "visual": {
        "core_description": "string",
        "entry_action": "string|null",
        "exit_action": "string|null"
      }
    }
  ]
}
Allowed Asset IDs:
${allowedAssetIds}
Script:
${script}
Beat Sheet JSON:
${beatSheetJson}
Asset Manifest JSON:
${assetManifestJson}
World Bible JSON:
${worldBibleJson}
User Asset Content JSON:
${userAssetContentJson}
Global Constraints JSON:
${globalConstraintsJson}
`
}

export function buildLoopPositionRules(): string {
  return `**Position Requirements (Perfect Loop Mode):**
Since the video must loop perfectly (the last frame connects to the first frame), all shots must provide a complete three-stage description:
- **First shot**: Must provide \`entry_action\`, describing how to transition smoothly from the last shot.
- **Middle shots**: Must provide \`entry_action\` and \`exit_action\`.
- **Last shot**: Must provide \`exit_action\`, describing how to transition smoothly back to the first shot.`
}

export function buildMusicLongTakeVisualScriptPrompt(params: {
  allowedAssetIds: string
  assetManifestJson: string
  beatSheetJson: string
  globalConstraintsJson: string
  mandatoryUserUploadBindingSection: string
  musicContextJson: string
  perfectLoop: boolean
  script: string
  userAssetContentJson: string
  userPrompt?: string
  worldBibleJson: string
}): string {
  const {
    allowedAssetIds,
    assetManifestJson,
    beatSheetJson,
    globalConstraintsJson,
    mandatoryUserUploadBindingSection,
    musicContextJson,
    perfectLoop,
    script,
    userAssetContentJson,
    userPrompt,
    worldBibleJson,
  } = params
  const userPromptSection = userPrompt?.trim()
    ? `
User Original Request:
${userPrompt.trim()}
`
    : ''

  return `Music Video Visual Contract

Role:
You are a music-video director translating a song into a beat-synced visual sequence.

Input:
The beat sheet below was derived from the SONG'S OWN MUSIC (a beat grid of downbeats, energy, and structural sections), not from text. Each beat is one shot, and its time_range is already locked to a musical beat, so the cut rhythm is decided by the music. Beats that fall on sung lyrics carry that text in segment_text; instrumental beats have an empty segment_text.
A Music Context JSON describes the song: genre, tempo (bpm), total duration, and the structural sections (verse / chorus / drop / bridge / outro ...) with their start/end times.

Goal:
Create one vivid, performable visual per beat so the finished video feels cut TO the music - visuals shift with the rhythm and escalate with the song's energy.

Core Rules:
- Honor the genre, tempo, and mood given in the Music Context JSON. Match the era and aesthetic the genre implies, and keep ONE cohesive visual world across the whole video - no jarring style or genre jumps between shots.
- Build the visual concept from the user's request, the song's lyrics or lack of lyrics, the World Bible, and the Music Context. Do not make the visual script depend only on transcript words.
- Treat the World Bible and Global Constraints as a motif palette and continuity guardrail, not a mandatory literal plot. Do not force every lyric into one invented storyline, rescue arc, or character relationship unless the user's request or lyrics explicitly require that exact plot.
- Treat hooks, repeated phrases, section changes, and instrumental moments as visual story beats. Keep the same central idea across the whole music video.
- Preserve lyric-local intent and emotional stance. If a line is playful, confident, seductive, confrontational, devotional, or ironic, keep that tone in the shot instead of flattening it into generic peace, salvation, or resolution.
- Translate lyrics like a music-video director, not an explainer. A lyric can become a literal image, symbolic motif, ironic contrast, performance moment, dance beat, fashion cue, lighting shift, or pure mood shot. Choose what best fits the song's genre, section energy, and visual world.
- Literal lyric imagery is allowed when it feels cinematic, iconic, recurring, or intentionally playful. Avoid a mechanical one-line / one-prop pattern where every phrase becomes a new isolated object, landmark, or location.
- Symbolism should behave like an MV motif, not an explanation. Root motifs in performer blocking, choreography, wardrobe, lighting, camera movement, location design, or one recurring visual object that evolves across hooks/choruses.
- Do not let a broad concept or location word (global, world, earth, unity, hope, freedom, healing) collapse into a long run of the same literal object or environment. A planet/globe/world shot can be an opener, bridge, or brief punctuation, but it must not occupy a whole verse, chorus, outro, or more than two adjacent beats unless the user explicitly requested a space/planet video.
- Do not over-bind one non-user prop anchor across many adjacent shots. If a prop or symbolic object recurs, vary the surrounding human action, performer, location, choreography, and camera language, and return quickly to people, places, movement, or performance rather than repeatedly showing the object itself.
- Keep broad themes like family, unity, freedom, hope, and healing specific to the world of the video: performers, friends, dancers, street scenes, stage moments, rooms, clubs, rehearsals, block parties, kitchens, cars, night exteriors, or other concrete lived-in settings. Generic parks, public-square crowds, hand-holding circles, and glowing-community tableaux are fallback choices, not defaults.
- Treat the section structure as the emotional arc: build through verses, peak on choruses/drops, and breathe on bridges/outros. Use the section start/end times to know which section each beat sits in.
- For beats WITH lyrics (non-empty segment_text): choose the strongest music-video response to the lyric: performance, emotion, relationship, movement, literal image, symbolic motif, ironic contrast, or atmosphere. Do not force every lyric into an explanatory illustration.
- For INSTRUMENTAL / NON-VOCAL beats (empty segment_text): people may appear, including singers/rappers as non-vocal performers, dancers, walkers, listeners, or expressive faces, but no one should sing, rap, speak, deliver vocals, lip-sync, mouth lyrics, or show visible mouth/lip movement. Keep every visible mouth closed or neutral throughout the shot. Do not set human_presence="singer_performance" for these beats; use "specific_character", "anonymous_crowd", or "background_people" when people are present.
- If the entire beat sheet has empty segment_text, treat it as a fully instrumental music video: use the user request, genre, mood, bpm, section energy, performers, dance, expressive faces, and vibrant environments to create a complete visual arc without any singing/rapping, vocal-delivery, lip-sync, or mouth/lip movement cues.
- For pop, rap, dance, and romantic songs, build lyric-bearing shots around music-video language first: artist/singer/rapper presence, singing to camera, dance, body movement, eye contact, expressive faces, fashion, lighting, crowd energy, stage/club/street/room environments, and rhythmic camera framing. On instrumental beats, use the same music-video energy through dance, body movement, camera, lighting, crowd, fashion, and environment only - not singing/rapping or mouth/lip cues.
- For repeated hooks and choruses, reuse central motifs but vary staging, camera distance, performer energy, color intensity, and environment. Escalate or transform the idea; do not repeat the same rescue/embrace/heart/light image each time.
- If Asset Manifest JSON contains a canonical singer anchor "char_singer" or another named Character asset whose asset_id, keyword, proper_name, visual_tag, visual_reference, or user intent identifies it as a singer, rapper, vocalist, artist, or performer, design a limited set of musically appropriate singer performance shots where that performer visibly sings or raps on camera only on lyric-bearing beats (non-empty segment_text), especially during hooks, choruses, drops, climaxes, title lyrics, or other vocal-emphasis moments. Include the exact singer/rapper performer asset_id in used_asset_id for those singer performance shots, and also allow that performer on empty segment_text beats only as a non-vocal person who dances, walks, poses, reacts, or carries expressive face/body/camera energy with mouth closed or neutral throughout and without singing/rapping or mouth/lip movement. Keep shot variety high: do not default every lyric or long adjacent run to the singer performer. Rotate through story actors, dancers, crowds, B-roll, props, locations, camera energy, and symbolic motifs so the music video has a varied visual arc. Story actors, dancers, crowds, B-roll, symbolic shots, and atmosphere can still appear elsewhere without the singer performer.
- Do not stage singers/rappers with handheld microphones, mic stands, headset mics, recording booths, or visible recording gear. Even lip-syncable solo performance shots should be clean music-video performance moments driven by face, posture, movement, eye contact, camera, lighting, wardrobe, and environment - not microphone props.
- Do not resolve the story too early. Keep final chorus/outro shots alive with performance, motion, and music energy; avoid blank canvases or quiet fade-outs unless the song's ending clearly asks for stillness.
- Higher-energy sections deserve bolder motion, faster implied movement, and more dynamic framing; quieter sections deserve stillness, space, and restraint.
- Favor performable, generatable MV moments over explanatory lyric illustration. Symbolism is welcome when it feels like part of the video's recurring visual language, not a caption explaining the lyric.
- Do not write explanatory visual prose such as "embodying the message that...", "this represents...", or "showing the idea that..." inside shot descriptions. Describe the visible music-video moment directly.
- Do not show lyrics as text. Avoid visible text, captions, typography, signage, or UI unless the user explicitly asks for text or a specific uploaded asset requires it.
- Keep identity stable: preserve race, age, gender presentation, facial features, wardrobe logic, and any uploaded character references across shots. If user-uploaded character images are provided, follow them.
- Avoid sexualized, nude, or explicit imagery. Use safe music-video energy: dancing, performance, fashion, lighting, crowd, camera, and environment.

Position Rules:
${perfectLoop ? '- Perfect loop mode: provide entry_action and exit_action when they help the loop return to the opening visual.' : '- Non-loop mode: first shot entry_action should be null; last shot exit_action should be null.'}

Critical Hard Constraints:
1. Beat lock:
- Create exactly one shot per beat.
- Output shot count must equal beat_sheet length.
- Shot order must match beat order.

2. Shot ID:
- shot_id must be exactly String(beat_id).

3. Audio:
- audio must equal the corresponding beat segment_text verbatim. Use an empty string "" for instrumental beats.
- Do not paraphrase, rewrite, reorder, or add words.

4. Asset binding:
- Each shot must include used_asset_id: string[].
- used_asset_id may only contain IDs from the Allowed Asset IDs list below.
- If a shot depicts a recognizable character/object from the asset manifest, include its asset ID.
- If no relevant asset is needed, output [].
${mandatoryUserUploadBindingSection}

5. Human presence:
- Each shot must include human_presence with exactly one of: "none", "anonymous_crowd", "background_people", "specific_character", "singer_performance".
- Use "none" for landscapes, skies, planets, abstract visuals, objects, products, typography, and environments with no visible human or human-like figure.
- Use "anonymous_crowd" only for crowd/group/audience scenes where no individual person is the clear subject.
- Use "background_people" for incidental non-recognizable people who are not the shot subject.
- Use "specific_character" for a clear individual, actor, story character, dancer, or performer who is visible but not singing/rapping the lyric.
- Use "singer_performance" only when the shot has non-empty segment_text and clearly frames the canonical singer/rapper/performer singing, rapping, or delivering a vocal performance on camera.

6. Visual:
- visual.core_description is the keyframe source of truth. Make it concise, vivid, and specific.
- visual.entry_action and visual.exit_action describe motion into and out of the core state.

7. Output:
- Return JSON object only, with a top-level "shots" array.
- No markdown fences.
- No extra commentary.

Output item schema:
{
  "shots": [
    {
      "shot_id": "1",
      "audio": "string",
      "human_presence": "none|anonymous_crowd|background_people|specific_character|singer_performance",
      "used_asset_id": ["char_x", "prop_y"],
      "visual": {
        "core_description": "string",
        "entry_action": "string|null",
        "exit_action": "string|null"
      }
    }
  ]
}

Allowed Asset IDs:
${allowedAssetIds}

Music Context JSON:
${musicContextJson}
${userPromptSection}

Script:
${script}

Beat Sheet JSON:
${beatSheetJson}

Asset Manifest JSON:
${assetManifestJson}

World Bible JSON:
${worldBibleJson}

User Asset Content JSON:
${userAssetContentJson}

Global Constraints JSON:
${globalConstraintsJson}
`
}

export function buildNonLoopPositionRules(): string {
  return `**Position Requirements (Non-Loop Mode):**
The video has a clear beginning and end:
- **First shot**: \`entry_action\` must be null or omitted.
- **Middle shots**: Must provide \`entry_action\` and \`exit_action\` (if there is motion).
- **Last shot**: \`exit_action\` must be null or omitted.`
}
