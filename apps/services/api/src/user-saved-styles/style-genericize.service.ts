import { completion } from '@reelmakeeasy/common/llm/completion'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'

const GenericizeSchema = z.object({
  cleanedStyleText: z.string(),
})

// A reusable saved style must describe only HOW imagery looks, never WHAT is
// depicted, WHO it is for, or WHO appears and how they are staged. A style whose
// text names a brand ("...an ad for Acme Coffee...") gets baked into
// every project it is applied to and the image model renders that brand over the
// project's real kit. Likewise a style that carries subject/performance direction
// ("...place her at a desk, dress her in a red coat...") is appended
// to every shot's keyframe prompt, so it conjures an off-script person into shots
// that were meant to have none -- and, with no character reference bound, a
// different random person each time. This pass strips both brand and
// subject/staging context at save time. The generic vs. subject call is semantic,
// so it is an LLM task rather than a regex.
const GENERICIZE_SYSTEM = `You sanitize a reusable visual STYLE description for a video-generation pipeline.

A style describes only HOW imagery should look -- medium, color palette, lighting, composition, texture, shape language, mood, camera and lens feel. It must never state WHAT is depicted, WHO the video is for, or WHO appears and how they are cast, staged, posed, dressed, or what they do.

Remove any reference to a specific brand, company, product, service, app, campaign, organization, publication, or named real person or character WHEN it identifies the depicted subject, client, or entity -- including phrasing that frames the output as an ad, promo, or commercial "for" such a subject. The subject of a video comes from the project, never from the reusable style.

Also remove direction that casts, stages, or dresses a SPECIFIC subject -- who one particular person is, and how that person is cast, staged, blocked, posed, dressed, or given a specific body or face -- even when they are unnamed and referred to only by a pronoun or a generic noun. Examples to remove: "keep the same face from the reference photo", "present her with a slimmer figure", "dress him in a tailored suit", "stage her at a microphone", "a woman walking on a beach". Casting, wardrobe, staging, and a specific subject's identity or body always come from the project's script and assets, never from the reusable style.

KEEP legitimate aesthetic and art-direction references that describe a look rather than a specific subject: art movements and design traditions (for example Bauhaus, Art Deco, Swiss International, Memphis) and named visual or cinematic styles, even when they carry a creator or studio name (for example film noir, Ghibli-esque, Wes Anderson symmetry) -- strip a creator, studio, or brand name only when it identifies the depicted subject or client, never when it names a style. Also KEEP generic stylistic depiction rules that define how ANY subject is rendered -- for example "faces use large expressive eyes", "soft rounded character proportions", "warm painterly skin shading", "shallow depth of field keeps the subject in focus". These describe how any subject is rendered, not who a specific person is or how they are cast and staged.

Preserve the original wording, order, and language of everything you keep -- excise only the identifying subject, casting, and staging references and make the minimal grammatical repair needed for the result to read cleanly. If there is nothing to remove, return the text exactly unchanged.

Return only the cleaned style description as cleanedStyleText.`

/**
 * Strips brand / subject context from a reusable style description before it is
 * persisted. Applied at every UserSavedStyle save chokepoint.
 *
 * Fail-open: any error returns the original text. A style save must never be
 * blocked by this guard -- the leak it prevents is downstream and rare, whereas
 * a blocked save is immediate and user-facing. (A genuinely all-brand style
 * legitimately genericizes to empty, which downstream treats as "no style".)
 */
@Injectable()
export class StyleGenericizeService {
  private readonly logger = new Logger(StyleGenericizeService.name)

  async genericize(styleText: string): Promise<string> {
    const trimmed = styleText?.trim()
    if (!trimmed) {
      return styleText
    }
    try {
      const result = await completion({
        models: ['gemini-3.8-flash', 'gpt-4o-mini'],
        prompt: `${GENERICIZE_SYSTEM}\n\nSTYLE DESCRIPTION:\n"""\n${trimmed}\n"""`,
        responseFormat: GenericizeSchema,
        task: 'user-saved-style-genericize',
        temperature: 0,
      })
      return result.cleanedStyleText.trim()
    } catch (error) {
      this.logger.warn(
        { error: ensureError(error) },
        'style genericize failed; persisting original style text',
      )
      return trimmed
    }
  }
}
