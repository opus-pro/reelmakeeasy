import { z } from 'zod'

import { OPENING_RULES, openingTemplatesList } from '../craft/opening-craft'

/** Where an autonomous idea comes from. */
export const IDEA_SOURCES = ['recent_news', 'fun_fact', 'famous_figure'] as const
export type IdeaSource = (typeof IDEA_SOURCES)[number]

/** The tag an idea's option label starts with, e.g. `Fun fact: Octopuses have three hearts`. */
export const SOURCE_TAGS: Record<IdeaSource, string> = {
  famous_figure: 'Famous figure',
  fun_fact: 'Fun fact',
  recent_news: 'Recent news',
}

/** Easy's length card for a story video (Dynamic or Calm): the lengths, the first one
 *  recommended, each with what it gives the viewer. */
export const STORY_LENGTHS = [30, 45, 60] as const
export type StoryLength = (typeof STORY_LENGTHS)[number]
export const STORY_LENGTH_DESCRIPTIONS: Record<StoryLength, string> = {
  30: 'Quick and punchy: the hook, the key facts and a clear ending.',
  45: 'Room for one more fact or example.',
  60: 'The full story, with time to explain each step.',
}
/** The length card's info line for a story video. */
export const STORY_LENGTH_INFO =
  'The voice-over is written to fit this length. A longer video takes longer to make and costs more.'

const NEWS_WINDOW_DAYS = 14

const daysBefore = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)

/** One fun-fact topic is drawn per search, so the facts don't settle on the same favourite. */
export const FUN_FACT_TOPICS = [
  'animals',
  'ancient history',
  'architecture',
  'art',
  'food and cooking',
  'geography',
  'insects',
  'inventions',
  'language and words',
  'mathematics',
  'music',
  'plants',
  'space',
  'sports',
  'technology',
  'the human body',
  'the ocean',
  'weather',
] as const

/** One kind of famous figure is drawn per search, for the same reason. */
export const FIGURE_KINDS = [
  'a composer or musician',
  'a philosopher',
  'a pioneering woman in any field',
  'a ruler or political leader',
  'a scientist',
  'a writer or poet',
  'an artist or painter',
  'an athlete',
  'an explorer',
  'an inventor',
] as const

/** An idea already offered in an earlier chat. */
export interface PastIdea {
  hook: string
  title: string
}

/** What keeps each search's ideas fresh: earlier ideas to avoid, and this search's topic and
 *  kind of figure. */
export interface IdeaVariety {
  avoid: readonly PastIdea[]
  figureKind: string
  funFactTopic: string
}

/** At most this many earlier ideas go into the prompt (newest first). */
export const MAX_AVOIDED_IDEAS = 40

const HOOK_CHARS = 120

/** The ideas step (web search on). `today` is an ISO date, e.g. `2026-10-01`. */
export const IDEAS_PROMPT = (today: string, variety: IdeaVariety): string => {
  const avoid = variety.avoid.slice(0, MAX_AVOIDED_IDEAS).map((idea) => {
    const hook = idea.hook.length > HOOK_CHARS ? `${idea.hook.slice(0, HOOK_CHARS)}...` : idea.hook
    return hook ? `- ${idea.title}: ${hook}` : `- ${idea.title}`
  })
  return [
    `Find three ideas for a short vertical explainer video. Today's date is ${today}.`,
    '',
    'Return exactly three ideas, one from each source:',
    `- recent_news: a real news story whose finding or event was first published or announced in the last ${NEWS_WINDOW_DAYS} days (on or after ${daysBefore(today, NEWS_WINDOW_DAYS)}). Find it with web search. Many articles re-share old discoveries, so trace the story back to the original paper, press release or announcement, check its date with more than one source, and skip it if the finding itself is older.`,
    `- fun_fact: a little-known, surprising fun fact about ${variety.funFactTopic}. Never present an old discovery as new.`,
    `- famous_figure: a widely known historical person, one most people have heard of, who is ${variety.figureKind}, and a surprising angle on them.`,
    '',
    'Fact-check every idea before you return it: confirm each claim with web search against at least two reputable sources (the original paper, a museum, a university, a major newspaper), and drop any idea you cannot confirm.',
    '',
    'Order the ideas best first: the first one is the idea you would most recommend making.',
    ...(avoid.length
      ? [
          '',
          'These ideas were already offered before. Do not suggest any of them again, and do not reuse their subjects (the same animal, person, event or fact) under a different title:',
          ...avoid,
        ]
      : []),
    '',
    'For each idea give:',
    '- source: recent_news, fun_fact or famous_figure.',
    '- title: at most 8 words.',
    '- hook: one sentence that makes people want to watch. Plain text only: no links, no markdown, no citations.',
    '- sourceUrl: the URL of the page the idea comes from, or an empty string if there is none.',
    '- when: for recent_news, the date the finding or event was first published or announced (YYYY-MM-DD); for fun_fact and famous_figure, the year or period it dates from (for example 2006, or 1st century).',
    '',
    'Write in English. Do not ask questions, run commands or change files: just answer.',
  ].join('\n')
}

/** The ideas step's `outputSchema` (strict: every object closed, every property required). */
export const IDEAS_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    ideas: {
      items: {
        additionalProperties: false,
        properties: {
          hook: { type: 'string' },
          source: { enum: [...IDEA_SOURCES], type: 'string' },
          sourceUrl: { type: 'string' },
          title: { type: 'string' },
          when: { type: 'string' },
        },
        required: ['source', 'title', 'hook', 'sourceUrl', 'when'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['ideas'],
  type: 'object',
}

const IdeaSchema = z.object({
  hook: z.string().trim().min(1),
  source: z.enum(IDEA_SOURCES),
  sourceUrl: z.string().trim(),
  title: z.string().trim().min(1),
  when: z.string().trim().min(1),
})
export type Idea = z.infer<typeof IdeaSchema>

/**
 * Why the recent-news idea isn't recent news, or null when it is: its `when` must be a date
 * (YYYY-MM-DD) within the news window ending `today`. Articles often re-share old discoveries, so
 * the date is the finding's own, and a stale one is rejected rather than trusted.
 */
export function staleRecentNews(ideas: readonly Idea[], today: string): null | string {
  const news = ideas.find((idea) => idea.source === 'recent_news')
  if (!news) return null
  const earliest = daysBefore(today, NEWS_WINDOW_DAYS)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(news.when) ? news.when : null
  if (date && date >= earliest && date <= today) return null
  return `the news idea must have been first published between ${earliest} and ${today}, not "${news.when}"`
}

/** Exactly three ideas, one per source (best first, as Codex ranked them). */
export const IdeasSchema = z.object({
  ideas: z
    .array(IdeaSchema)
    .length(3, 'Expected exactly three ideas')
    .refine((ideas) => new Set(ideas.map((i) => i.source)).size === ideas.length, {
      message: 'Expected one idea from each source',
    }),
})

/** The polish step: the chosen idea (an option's full idea, or the user's own text) -> a brief. */
export const POLISH_PROMPT = (choice: string): string =>
  [
    'Turn this idea into a brief for a short vertical explainer video.',
    '',
    'Idea:',
    choice,
    '',
    'The brief is what someone would type into a video maker to ask for this video: 2-4 sentences covering the hook, the angle, the key beats and the tone. Keep every fact accurate.',
    'Fact-check every claim with web search before you write it, and keep only what reputable sources confirm.',
    `Keep the timing true: the idea's date is for your check, so do not put dates in the brief. Never call it new, recent or just discovered unless it is recent news first published in the last ${NEWS_WINDOW_DAYS} days.`,
    '',
    'Also give a title: at most 8 words.',
    '',
    'Write in English, in plain text: no links, no markdown. Do not ask questions, run commands or change files: just answer.',
  ].join('\n')

/** The polish step's `outputSchema` (strict). The length is the user's (Easy's length card). */
export const BRIEF_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    brief: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['title', 'brief'],
  type: 'object',
}

export const BriefSchema = z.object({
  brief: z.string().trim().min(1),
  title: z.string().trim().min(1),
})
export type Brief = z.infer<typeof BriefSchema>

/** The openings step: three first lines for this brief, each in a different hook style. */
export const OPENINGS_PROMPT = (brief: Pick<Brief, 'brief' | 'title'>): string =>
  [
    'Write three opening lines for this short vertical explainer video.',
    '',
    `Title: ${brief.title}`,
    'Brief:',
    brief.brief,
    '',
    'Each opening is the exact first line the voice-over will say. These are the proven short-video opener templates, by group:',
    openingTemplatesList(),
    '',
    "Pick the three templates that make the strongest hook for this video, ideally from different groups, and fill in the brackets with concrete everyday words from the brief. Keep each template's wording; small grammar changes are fine.",
    '',
    'Rules:',
    OPENING_RULES,
    '',
    'Order them best first: the first is the one you would most recommend for this video.',
    'For each give: style (the group name of its template), line (the filled-in opener), why (one short sentence on why it makes a scrolling viewer stop).',
    '',
    'Write in English, in plain text. Do not ask questions, run commands or change files: just answer.',
  ].join('\n')

/** The openings step's `outputSchema` (strict). */
export const OPENINGS_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    openings: {
      items: {
        additionalProperties: false,
        properties: {
          line: { type: 'string' },
          style: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['style', 'line', 'why'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['openings'],
  type: 'object',
}

const OpeningSchema = z.object({
  line: z.string().trim().min(1),
  style: z.string().trim().min(1),
  why: z.string().trim(),
})
export const OpeningsSchema = z.object({ openings: z.array(OpeningSchema).length(3) })
export type Opening = z.infer<typeof OpeningSchema>
