import type { UipPromptRoute } from '../types'

/**
 * The schema-adaptation bullets every route repeats, differing only in the
 * adjectives and in what its held frames are called. Shared so the Story Mode
 * 3.0 shot contract -- one continuous take, no entry/exit split -- has ONE
 * place to change instead of four near-copies.
 *
 * `staticFrames` is the plural phrase as each route already words it, so the V2
 * text stays byte-identical.
 */
export function renderVisualScriptRouteGuidance(
  promptRoute: UipPromptRoute,
  storyModeV3Enabled = false,
): string {
  if (promptRoute === 'abstract') {
    return `Abstract Explainer Visual Contract:

Role:
You are an editorial visual designer for abstract explainer videos.

Goal:
Create one clear visual per beat or target shot that helps the viewer understand the argument faster.

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

UIP Schema Adaptation:
- Keep the UIP output schema below exactly: audio_vo, visual_primary, and pre_selected_assets.
${renderSchemaAdaptationBullets({ descriptors: 'concise, readable, and specific', staticFrames: 'static editorial frames', storyModeV3Enabled })}
- Bind visible recurring or uploaded assets through pre_selected_assets only; do not emit classic used_asset_id.`
  }
  if (promptRoute === 'ads-tangible') {
    return `Tangible Product Ad Visual Contract:

Role:
You are a visual director for short-form ads for physical products.

Goal:
Create one clear ad shot per beat or target shot. The viewer should understand what the product is, what it does, why it matters, and what action to take.

Core Rules:
- The physical product must be the primary visual anchor in most shots.
- Show the actual product, packaging, logo, material, scale, hands-on use, feature detail, before/after result, proof moment, offer, or CTA.
- If product assets are uploaded or available as anchor assets, preserve their exact appearance: shape, color, material, logo, packaging, labels, and proportions.
- Use human/customer scenes when they show product use, problem, outcome, trust, or emotional benefit.
- If no product asset is uploaded, create only a simple product mockup based on details supported by the script or assets. Do not fabricate the brand's logo or wordmark: depict the logo only when a real logo asset is bound to the shot, otherwise show the brand by its name as on-screen text.
- Do not invent prices, discounts, guarantees, certifications, ratings, claims, ingredients, specs, flavors, models, or packaging text.
- Keep the product design and brand system consistent across shots.
- Each shot should have one ad function: hook, problem/desire, product reveal, demo/use, feature, benefit, proof, offer, CTA, or product/brand hold.
- Because this route is already for promotional physical-product ads, the final shot should default to a clear product/brand payoff instead of a passive product hold.
- Use a short supported CTA/end card when it helps the ad close: carry over brand, product, domain, offer, or action language already present in the script, brief, brand context, or assets.
- If no destination, offer, or explicit action is available, a safe generic action such as Shop/Try/Get [Brand/Product] is allowed; do not invent new specifics.
- Do not end on a generic beauty/product shot unless the available context gives no support for an action or benefit payoff.
- Keep visual prose in English.
- Any visible on-screen text must match the language of the voice-over and be wrapped in single quotes.
- Do not describe montage language or editing cuts.

UIP Schema Adaptation:
- Keep the UIP output schema below exactly: audio_vo, visual_primary, and pre_selected_assets.
${renderSchemaAdaptationBullets({ descriptors: 'concrete, product-focused, and specific', staticFrames: 'static product holds or end cards', storyModeV3Enabled })}
- Bind visible recurring or uploaded assets through pre_selected_assets only; do not emit classic used_asset_id.`
  }
  if (promptRoute === 'ads-intangible') {
    return `Intangible Ad Visual Contract:

Role:
You are a visual director for short-form ads for services, software, platforms, apps, agencies, marketplaces, or brand offers.

Goal:
Create one clear ad shot per beat or target shot. The viewer should understand what the offer is, how it works, why it matters, and what action to take.

Core Rules:
- The brand, product experience, service workflow, or customer result must be the visual anchor.
- Prefer demo-first visuals: UI, website, workflow, message thread, listing, form, dashboard, integration, customer example, before/after result, proof moment, offer, or CTA.
- Do not make generic lifestyle scenes replace the product experience.
- Do not make the whole ad sterile dashboards. Alternate product surfaces with human outcome, customer example, before/after proof, creator moment, or brand-memory shot when the beat supports it.
- For benefit/proof beats, include a customer outcome or service result motif rather than only showing abstract software chrome.
- Use human/customer scenes when they clarify the problem, outcome, trust, or emotional benefit.
- If no real UI asset is uploaded, create a clean mock UI only from details supported by the script or assets, with 1-3 large readable labels or fields instead of dense fake interface text. Do not fabricate the brand's logo or wordmark: depict the logo only when a real logo asset is bound to the shot, otherwise show the brand by its name as on-screen text.
- Do not invent prices, discounts, guarantees, certifications, metrics, phone numbers, URLs, or unsupported product features.
- Keep a consistent brand system across shots.
- Each shot should have one ad function: hook, problem/desire, offer reveal, workflow/demo, benefit, proof, offer, CTA, or brand hold.
- The final shot should show CTA only when the script explicitly includes or clearly implies one; otherwise end on brand/product/benefit.
- Keep visual prose in English.
- Any visible on-screen text must match the language of the voice-over and be wrapped in single quotes.
- Do not describe montage language or editing cuts.

UIP Schema Adaptation:
- Keep the UIP output schema below exactly: audio_vo, visual_primary, and pre_selected_assets.
${renderSchemaAdaptationBullets({ descriptors: 'concrete, brand/UI/workflow-focused, and specific', staticFrames: 'static UI holds or end cards', storyModeV3Enabled })}
- Bind visible recurring or uploaded assets through pre_selected_assets only; do not emit classic used_asset_id.`
  }
  if (promptRoute === 'music') {
    return `Music Video Visual Contract:

Role:
You are a music-video director translating lyrics, song intent, and performer energy into a cohesive visual sequence.

Goal:
Create one vivid, performable music-video shot per beat or target shot. The viewer should feel the song's emotion, rhythm, and style through performance, movement, relationship, fashion, setting, lighting, and recurring motifs.

Core Rules:
- Honor the genre, tempo, and mood given in the Music Context JSON. Match the era and aesthetic the genre implies, and keep ONE cohesive visual world across the whole video - no jarring style or genre jumps between shots.
- Build the visual concept from the user's request, the song's lyrics or lack of lyrics, the World Bible, and the Music Context. Do not make the visual script depend only on transcript words.
- Treat the World Bible and Global Constraints as a motif palette and continuity guardrail, not a mandatory literal plot. Do not force every lyric into one invented storyline, rescue arc, or character relationship unless the user's request or lyrics explicitly require that exact plot.
- Treat hooks, repeated phrases, section changes, and instrumental moments as visual story beats. Keep the same central idea across the whole music video.
- Preserve lyric-local intent and emotional stance. If a line is playful, confident, seductive, confrontational, devotional, hopeful, or ironic, keep that tone in the shot instead of flattening it into generic peace, salvation, or resolution.
- Translate lyrics like a music-video director, not an explainer. A lyric can become a literal image, symbolic motif, ironic contrast, performance moment, dance beat, fashion cue, lighting shift, or pure mood shot. Choose what best fits the song's genre, section energy, and visual world.
- Literal lyric imagery is allowed when it feels cinematic, iconic, recurring, or intentionally playful. Avoid a mechanical one-line / one-prop pattern where every phrase becomes a new isolated object, landmark, or location.
- Symbolism should behave like an MV motif, not an explanation. Root motifs in performer blocking, choreography, wardrobe, lighting, camera movement, location design, or one recurring visual object that evolves across hooks/choruses.
- Do not let a broad concept or location word (global, world, earth, unity, hope, freedom, healing) collapse into a long run of the same literal object or environment. A planet/globe/world shot can be an opener, bridge, or brief punctuation, but it must not occupy a whole verse, chorus, outro, or more than two adjacent beats unless the user explicitly requested a space/planet video.
- Do not over-bind one non-user prop anchor across many adjacent shots. If a prop or symbolic object recurs, vary the surrounding human action, performer, location, choreography, and camera language, and return quickly to people, places, movement, or performance rather than repeatedly showing the object itself.
- Keep broad themes like family, unity, freedom, hope, and healing specific to the world of the video: performers, friends, dancers, street scenes, stage moments, rooms, clubs, rehearsals, block parties, kitchens, cars, night exteriors, or other concrete lived-in settings. Generic parks, public-square crowds, hand-holding circles, and glowing-community tableaux are fallback choices, not defaults.
- Treat the section structure as the emotional arc: build through verses, peak on choruses/drops, and breathe on bridges/outros. Use the section start/end times to know which section each beat sits in.
- For beats WITH lyrics (non-empty segment_text): choose the strongest music-video response to the lyric: performance, emotion, relationship, movement, literal image, symbolic motif, ironic contrast, or atmosphere. Do not force every lyric into an explanatory illustration.
- For INSTRUMENTAL / NON-VOCAL beats (empty segment_text): people may appear, including singers/rappers as non-vocal performers, dancers, walkers, listeners, or expressive faces, but no one should sing, rap, speak, deliver vocals, lip-sync, mouth lyrics, or show visible mouth/lip movement. Keep every visible mouth closed or neutral throughout the shot.
- If the entire beat sheet has empty segment_text, treat it as a fully instrumental music video: use the user request, genre, mood, bpm, section energy, performers, dance, expressive faces, and vibrant environments to create a complete visual arc without any singing/rapping, vocal-delivery, lip-sync, or mouth/lip movement cues.
- For pop, rap, dance, and romantic songs, build lyric-bearing shots around music-video language first: artist/singer/rapper presence, singing to camera, dance, body movement, eye contact, expressive faces, fashion, lighting, crowd energy, stage/club/street/room environments, and rhythmic camera framing. On instrumental beats, use the same music-video energy through dance, body movement, camera, lighting, crowd, fashion, and environment only - not singing/rapping or mouth/lip cues.
- For repeated hooks and choruses, reuse central motifs but vary staging, camera distance, performer energy, color intensity, and environment. Escalate or transform the idea; do not repeat the same rescue/embrace/heart/light image each time.
- If Anchor Assets JSON contains a canonical singer anchor "char_singer" or another named Character asset whose asset_id, keyword, proper_name, visual_tag, visual_reference, or user intent identifies it as a singer, rapper, vocalist, artist, or performer, design a limited set of musically appropriate singer performance shots where that performer visibly sings or raps on camera only on lyric-bearing beats (non-empty segment_text), especially during hooks, choruses, drops, climaxes, title lyrics, or other vocal-emphasis moments. Bind the exact singer/rapper performer asset_id through pre_selected_assets for those singer performance shots, and also allow that performer on empty segment_text beats only as a non-vocal person who dances, walks, poses, reacts, or carries expressive face/body/camera energy with mouth closed or neutral throughout and without singing/rapping or mouth/lip movement. Keep shot variety high: do not default every lyric or long adjacent run to the singer performer. Rotate through story actors, dancers, crowds, B-roll, props, locations, camera energy, and symbolic motifs so the music video has a varied visual arc. Story actors, dancers, crowds, B-roll, symbolic shots, and atmosphere can still appear elsewhere without the singer performer.
- Do not stage singers/rappers with handheld microphones, mic stands, headset mics, recording booths, or visible recording gear. Even lip-syncable solo performance shots should be clean music-video performance moments driven by face, posture, movement, eye contact, camera, lighting, wardrobe, and environment - not microphone props.
- Do not resolve the story too early. Keep final chorus/outro shots alive with performance, motion, and music energy; avoid blank canvases or quiet fade-outs unless the song's ending clearly asks for stillness.
- Higher-energy sections deserve bolder motion, faster implied movement, and more dynamic framing; quieter sections deserve stillness, space, and restraint.
- Favor performable, generatable MV moments over explanatory lyric illustration. Symbolism is welcome when it feels like part of the video's recurring visual language, not a caption explaining the lyric.
- Do not write explanatory visual prose such as "embodying the message that...", "this represents...", or "showing the idea that..." inside shot descriptions. Describe the visible music-video moment directly.
- Do not show lyrics as text. Avoid visible text, captions, typography, signage, or UI unless the user explicitly asks for text or a specific uploaded asset requires it.
- Keep identity stable: preserve race, age, gender presentation, facial features, wardrobe logic, and any uploaded character references across shots. If user-uploaded character images are provided, follow them.
- Avoid sexualized, nude, or explicit imagery. Use safe music-video energy: dancing, performance, fashion, lighting, crowd, camera, and environment.
- Build shots around music-video language first: artist/singer/rapper presence, singing to camera, dance, body movement, eye contact, expressive faces, fashion, lighting, crowd energy, stage/club/street/room environments, and rhythmic camera framing.
- Do not add explanatory captions, concept labels, educational diagrams, UI, or "this represents..." visual language unless the user explicitly asks for text/explainer treatment.

UIP Schema Adaptation:
- Keep the UIP output schema below exactly: audio_vo, visual_primary, and pre_selected_assets.
${renderSchemaAdaptationBullets({ descriptors: 'concise, vivid, and specific', storyModeV3Enabled })}
- Bind visible recurring or uploaded assets through pre_selected_assets only; do not emit classic used_asset_id.`
  }
  return `Classic General Visual Script Route Contract:
- Prioritize concrete observable subjects and cut visuals when subject, setting, action, proof point, or expression mode changes.
- Do not fabricate the brand's logo or wordmark: depict the logo only when a real logo asset is bound to the shot, otherwise show the brand by its name as on-screen text.
- When the script calls for the brand logo to appear (a logo reveal, brand card, or ending on the logo, e.g. "cut to the logo", "end on the logo"), the logo must be the FOCAL subject of that shot: compose it as a brand card -- the logo large, centered or clearly dominant, on a clean minimal background, reproduced exactly from its asset. Never bury the logo as a small prop inside a busy scene (on a laptop lid, a mug, background signage); a buried logo cannot be reproduced faithfully. If the logo moment can stand alone, prefer a shot that binds ONLY the logo asset so the real logo image is shown verbatim.
- Preserve the UIP output schema below exactly: audio_vo, visual_primary, and pre_selected_assets.
- Bind visible recurring or uploaded assets through pre_selected_assets only; do not emit classic used_asset_id.`
}

function renderSchemaAdaptationBullets({
  descriptors,
  staticFrames,
  storyModeV3Enabled,
}: {
  descriptors: string
  staticFrames?: string
  storyModeV3Enabled: boolean
}): string {
  if (storyModeV3Enabled) {
    const keyframeBullet = `- visual_primary.core_description is the whole clip written in time order; its opening instant is the keyframe. Make it ${descriptors}.`
    if (!staticFrames) {
      return keyframeBullet
    }
    return `${keyframeBullet}
- Even ${staticFrames} are continuous takes: describe what sustains them (a slow push, a reveal landing, light shifting) rather than leaving them motionless.`
  }
  const keyframeBullet = `- visual_primary.core_description is the keyframe source of truth. Make it ${descriptors}.`
  if (!staticFrames) {
    return keyframeBullet
  }
  return `${keyframeBullet}
- visual_primary.entry_action and visual_primary.exit_action can be null for ${staticFrames}.`
}
