/**
 * How a ReelMakeEasy video opens: proven short-video opener templates and the rules for filling
 * them. One source for the Easy flow's openings step (and, later, the
 * video-craft skill). The templates are the owner's list of the 30 openers most used in short
 * videos; Codex picks the ones that fit a video and fills in the brackets.
 */
export const OPENING_TEMPLATES = [
  {
    group: 'Curiosity',
    templates: [
      'Did you know [surprising fact]?',
      'Ever wonder why [odd thing] happens?',
      "You've been doing [task] wrong your whole life.",
      'Nobody talks about this part of [topic].',
      "This sounds fake, but it's true.",
      'What happens when you [action] for 30 days?',
      "The secret [industry] doesn't want you to know.",
      'Guess what happens next.',
    ],
  },
  {
    group: 'Callout',
    templates: [
      "If you're a [audience], stop scrolling.",
      'If you struggle with [problem], watch this.',
      "Don't [action] until you watch this.",
      'Before you buy [product], know this.',
      'Stop wasting money on [thing].',
      'Tired of [frustration]? Try this.',
      'This is your sign to [action].',
    ],
  },
  {
    group: 'Opinion',
    templates: ['Unpopular opinion: [bold claim].', "You don't need [thing everyone buys]."],
  },
  {
    group: 'List',
    templates: [
      '3 things I wish I knew before [experience].',
      '5 [tools/habits] that feel illegal to know.',
      "7 signs you're [state].",
      '4 mistakes every beginner makes in [field].',
    ],
  },
  {
    group: 'Story',
    templates: [
      "I tried [thing] so you don't have to.",
      'I was today years old when I learned this.',
      "I quit [thing] and here's what happened.",
      'A year ago I was [bad situation]. Today, [good situation].',
      'How I got [result] in [timeframe].',
      "I tested [number] [things]. Here's the winner.",
    ],
  },
  {
    group: 'How-to',
    templates: [
      "Here's how to [result] without [pain].",
      'The lazy way to [goal].',
      'Save this for the next time you [situation].',
    ],
  },
] as const

export const OPENING_RULES = [
  '- The first sentence opens a specific question or loop that the video then answers, within the first ~3 seconds: at most 12 words.',
  '- Concrete beats vague: a real object, number, place or person, not "you won\'t believe this".',
  '- Say the surprising thing in familiar modern words the viewer already knows: "a vending machine", not "a coin that bought holy water".',
  '- Never start with a greeting, "In this video", or "Let\'s talk about".',
  '- Never overpromise: the video must actually deliver what the opening promises.',
  "- Never invent a personal experience: use a Story template only when the video really is the narrator's own story.",
  '- Plain spoken text: no emoji, hashtags, links or stage directions.',
].join('\n')

/** The templates as prompt lines, grouped: `- Curiosity: Did you know [surprising fact]? | ...`. */
export function openingTemplatesList(): string {
  return OPENING_TEMPLATES.map(
    ({ group, templates }) => `- ${group}: ${templates.join(' | ')}`,
  ).join('\n')
}

/** The info tooltip on the attention-hook card: what an attention hook is. */
export const ATTENTION_HOOK_INFO =
  "An attention hook is the video's first line. People decide in about 3 seconds whether to keep watching, so it raises a question or makes a promise the rest of the video pays off."
