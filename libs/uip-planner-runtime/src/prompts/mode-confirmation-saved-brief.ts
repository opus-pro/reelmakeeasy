// The "Saved brand brief" prompt block for mode_confirmation. Extracted from
// mode-confirmation-prompt.ts to keep that file under the max-lines cap.
//
// A brand-library brief attached at session start (brand_bank_source.kind ===
// 'brand_library') renders one of two shapes:
//   - EDITABLE (brand_extraction.status === 'completed', editable-review patch on): the
//     brief seeds an editable brand_review. The phase machine routes
//     mode_confirmation -> bootstrap_brand -> brand_review with no extraction
//     child; the user reviews/edits the pre-filled bank like a fresh extraction.
//     An AUTO-DETECTED brief (attached_via 'auto_detect') MUST announce
//     itself per the never-silent rule; an explicit pick needs no
//     surprise-explanation, just a light acknowledgement.
//   - LEGACY locked (status === 'locked', editable-review patch off): pre-locked
//     skip path. Only reached by pre-patch sessions.

// Shared escape-hatch tail: the two chat ops the user can use to back
// out of an attached brief. Identical for both shapes -- both remain valid in
// mode_confirmation (the brief is attached, brand_bank_source.kind ===
// 'brand_library'), enforced by planner-contract-brand.ts.
const SAVED_BRIEF_ESCAPE_HATCHES = `
- The user has two escape hatches for the attached brief (there is no detach button yet). Emit them ONLY when the user clearly asks, as a PATCH_SPEC carrying that ONE op plus a reply -- never act silently and never emit them unprompted. CRITICAL: the reply must KEEP THE INTAKE MOVING, not end on a bare confirmation. A PATCH_SPEC turn does not auto-advance the conversation, so a reply that only confirms leaves the user with nothing to answer and the session stalls. Always fold the next step into the same reply:
  - "remove the brand brief" / "don't use the brand info" / "drop the brand" -> \`{ "op": "remove_saved_brand_brief" }\`. The brief detaches from THIS project only (it stays in their library). In the reply: confirm the brand is removed and this video will not use it, THEN immediately re-ask whatever mode_confirmation question is still open (e.g. the video length, or the next §2.3 convergence question) so the user can keep going. Example: "Done -- this video won't use your saved Acme Co. brand. How long would you like it to be?" After this the session has no brand: do not re-offer it or run extraction.
  - "re-extract" / "refresh the brand info" / "pull the brand again" -> \`{ "op": "reextract_saved_brand_brief" }\`. Use when the saved brand looks stale or wrong. In the reply: say you'll pull their brand fresh, THEN in the same reply ask them to confirm or share the brand website to pull from -- their answer is what kicks off the fresh extraction. Example: "Sure -- I'll pull your brand fresh. What's the website I should use?" Do NOT end on a bare confirmation.
- These two ops are the ONLY PATCH_SPEC ops you may emit in this session, and only in direct response to such a request. Everything else stays ASK_CLARIFY / MODE_CONFIRMED.
- Everything else is the normal flow: §2.3 mode + duration convergence, refinement caps, and safety gates all still apply.`

// First-turn announcement. Auto-detected briefs MUST explain themselves (the
// user did not pick this brand -- attaching it silently violates the never-go-
// silent rule). An explicit pick only needs a light acknowledgement.
function announcementLine(attachedVia: 'auto_detect' | 'explicit'): string {
  return attachedVia === 'auto_detect'
    ? '- On your FIRST mode_confirmation turn, you MUST announce the match (never attach it silently): tell the user you matched their saved brand brief for `brand_bank.basic_info.business_name` from what they wrote, that you pre-filled it, and that they can review and edit it in the upcoming brand step -- or ask you to drop it or re-pull it (in their language, e.g. "I matched your saved Acme Co. brand and pre-filled it -- you\'ll get to review and tweak it next, or just say so if you\'d rather I drop it or pull it fresh."). Keep it to one or two short sentences; do not re-present this on later turns.'
    : '- On your FIRST mode_confirmation turn, tell the user you are using the saved brand brief they selected for `brand_bank.basic_info.business_name`, that they can review and edit it in the upcoming brand step, or ask you to drop it or re-pull it (in their language, e.g. "Using your selected Acme Co. brand -- you\'ll get to review and tweak it next, or just say so if you\'d rather I drop it or pull it fresh."). Keep it to one or two short sentences; do not re-present this on later turns.'
}

function buildEditableSavedBriefRules(attachedVia: 'auto_detect' | 'explicit'): string {
  return `

### Saved brand brief (this session)
The user's saved brand brief (from their brand library) was attached when this session started: \`brand_bank\` in the context is already populated (\`brand_extraction.status === 'completed'\`, \`brand_bank_source.kind === 'brand_library'\`), and \`brand_bank_source.attached_via\` records HOW (\`'explicit'\` = the user picked it pre-session; \`'auto_detect'\` = the runtime matched it from their prompt). It is NOT locked: no extraction runs (\`brand_extraction.input\` stays null BY DESIGN), but the brief seeds an EDITABLE brand profile the user reviews and edits in the upcoming brand_review step, just like a freshly extracted bank. The runtime routes MODE_CONFIRMED onward to that review automatically -- you do NOT pick the next phase for it.
${announcementLine(attachedVia)}
- The brand is already attached, so do NOT run the §2.6.1 brand-intent check and do NOT surface the Stage 1 brand options -- there is nothing to ask about how to learn the brand. Because no extraction ran (\`brand_extraction.input === null\`), §2.6.5 is a no-op here: do NOT ask the brand-direction question and do NOT set \`mode_update.brand_video_type\` (this is not the input-driven brand path; the user makes brand decisions in the upcoming review step).
- Ground topic / angle / audience suggestions in \`brand_bank\` fields exactly as if the brand questions had been answered.
- If the user asks to change the brand info itself during this intake, tell them they can review and edit the brand details in the upcoming brand step (or use the escape hatches below to drop or re-pull it); keep this turn focused on mode / duration / topic.${SAVED_BRIEF_ESCAPE_HATCHES}`
}

function buildLockedSavedBriefRules(): string {
  return `

### Saved brand brief (this session)
The user's saved brand brief (from their brand library) was attached when this session started: \`brand_bank\` in the context is already populated and LOCKED (\`brand_extraction.status === 'locked'\`, \`brand_bank_source.kind === 'brand_library'\`). It was confirmed by the user in a previous session. No extraction runs, no brand_review stage occurs, and \`brand_extraction.input\` stays null BY DESIGN -- this session is NOT on the §2.6 brand path, so MODE_CONFIRMED routes to bootstrap_script as usual (never bootstrap_brand).
- On your FIRST mode_confirmation turn, open by telling the user you are using their saved brand brief for \`brand_bank.basic_info.business_name\` AND that they can ask you to remove it or re-pull it if it is not what they want (in their language, e.g. "Using your saved brand brief for Acme Co. -- just say so if you'd rather I drop it or re-pull it fresh."). Keep it to one or two short sentences. Never attach it silently; do not re-present this on later turns.
- Brand context is settled: do NOT run the §2.6.1 brand-intent check, do NOT surface the Stage 1 brand options, and do NOT ask the §2.6.5 shape or §2.6.6 direction questions. Set the \`mode_update.brand_video_type\` FIELD by §2.6.5 inference when the prompt or bank makes the arc obvious; otherwise leave it unset (a non-brand-path MODE_CONFIRMED does not require it).
- Ground topic / angle / audience suggestions in \`brand_bank\` fields exactly as if the brand questions had been answered.
- The attached brief is read-only in this session. If the user asks to change the saved brand info itself, say the attached brief stays fixed for this project and fold their requested change into session-level direction (topic / angle / tone) instead.${SAVED_BRIEF_ESCAPE_HATCHES}`
}

/**
 * Render the "Saved brand brief" block. Returns '' when no brief is attached.
 * `editable` is true for the editable-review seed (status 'completed');
 * false renders the legacy locked-skip block. `attachedVia` tailors the
 * first-turn announcement (auto-detected briefs must announce themselves).
 */
export function buildSavedBriefRules(opts: {
  attached: boolean
  attachedVia: 'auto_detect' | 'explicit'
  editable: boolean
}): string {
  if (!opts.attached) {
    return ''
  }
  return opts.editable
    ? buildEditableSavedBriefRules(opts.attachedVia)
    : buildLockedSavedBriefRules()
}
