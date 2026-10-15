export function buildLongTakeGenrePrompt(): string {
  return `You must classify and define the genre of the requested video based on all available inputs.

Your output will be passed to the Scriptwriter. The Scriptwriter needs to understand:

- what genre of video they are writing
- what the video is trying to achieve
- how the requested style could be applied within that genre
- what genre-specific and style-specific considerations should shape the script

Use the following genres as reference points, but do not treat them as a strict limit:
- Educational
- Explainer
- Instructional / How-to
- Story / Personal Narrative
- News / Update
- Commentary / Opinion
- Documentary / Historical Reconstruction
- Fiction / Short Film
- Promotional / Marketing
- Announcement / Informational Comms

Think beyond simply naming the genre. Include any information that would help the Scriptwriter produce a stronger script.

Important distinction: genre vs. style:
Users may request any style, but style is not the same as genre
- Genre = what the content is trying to do
- Style = how the content should feel

**Style Authority Rule (CRITICAL):**
The style reference image is the authoritative source of visual style — not the user prompt.
- Users don't usually have precise style vocabulary. Style-related language in the user prompt (e.g. "minimalist", "cinematic", "bold") should be treated as low-weight intent context — not as a style directive.
- The actual style system is defined by the style reference image provided in the Pipeline Context.
- If the user's style language conflicts with the style reference image, follow the style reference image.
- The user prompt can influence intent, tone, pacing, or small content details — but must not redefine the core visual characteristics established by the style reference.

**Your output should classify:**
A. Genre
- What kind of content is this?
- Primary genre
- Optional secondary genre
- Confidence
- Reasoning
B. Style
- How should it feel?
- How should the style input be expressed within this genre?
- How should style affect tone, pacing, voice, framing, or delivery?
C. Genre-specific considerations
- How should a script in this genre differ from a generic script?
- What must the Scriptwriter include?
- What structure best fits this genre?
- What should the Scriptwriter pay special attention to?

Why primary + secondary genre matters:
- Many videos are hybrids, for example:
  - Educational + Story
  - News + Commentary
  - Announcement + Explainer
  - Documentary / Historical Reconstruction +  Educational
  - Promotional + Explainer

Do not force a single label when a secondary genre would meaningfully improve the Scriptwriter's understanding.

Respond with ONLY this JSON (no markdown, no commentary):

{
  "primary_genre": "the main content genre",
  "secondary_genre": "optional secondary genre, or empty string if none",
  "confidence": 0.0,
  "reasoning": "brief explanation of genre classification",
  "style_application": {
    "overall_feel": "how the style should feel within this genre",
    "how_style_should_influence_script": ["specific guidance item 1", "guidance item 2", "..."]
  },
  "scriptwriter_guidance": {
    "core_goal": "what the scriptwriter must achieve above all else",
    "genre_specific_requirements": ["requirement 1", "requirement 2"],
    "structure_guidance": "recommended narrative structure for this genre",
    "audience_considerations": ["consideration 1", "consideration 2"],
    "pitfalls_to_avoid": ["pitfall 1", "pitfall 2"]
  }
}`
}
