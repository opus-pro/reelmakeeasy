/** The API's 409 for a message to a finished autonomous session, used as the composer hint. */
const AUTONOMOUS_FINISHED = 'This autonomous session is finished. Start a new session to chat.'

/** The composer's hint: what typing there does right now. */
export function composerPlaceholder({
  cardOrMessage,
  cardQuestions,
  editing,
  flowActive,
  flowFinished,
  modeChosen,
  pickUp,
  setupPending,
  singleQuestion,
  who,
  working,
}: {
  /** One of ReelMakeEasy's fixed cards is open in a chat: typing an option answers it, anything
   *  else is a message to the agent. */
  cardOrMessage: boolean
  /** Questions on an open card only its own Submit can answer (0 when none). */
  cardQuestions: number
  /** The finished video is being edited in this chat: a free chat again. */
  editing: boolean
  /** An autonomous flow runs: the composer only answers its cards. */
  flowActive: boolean
  /** An autonomous session whose flow is over: nothing more to type. */
  flowFinished: boolean
  modeChosen: boolean
  /** An Easy chat a restart cut off: its button above (named this) carries it on. */
  pickUp: false | string
  /** What a Motion Reel or Claude Animation chat still needs set up with its card, or null. */
  setupPending: null | string
  /** A one-question card is open that the composer can answer. */
  singleQuestion: boolean
  /** How the chat names its agent: Codex or Claude. */
  who: string
  working: boolean
}): string {
  if (!modeChosen) return 'Choose how to start above'
  if (setupPending) return `Set up your ${setupPending} above`
  if (editing) return 'Describe what to change…'
  if (pickUp) return `Press "${pickUp}" above to carry on`
  if (flowFinished) return AUTONOMOUS_FINISHED
  if (cardOrMessage && !working) return `Pick an option above, or message ${who}…`
  if (singleQuestion && !cardOrMessage) return 'Pick an option above, or type your answer'
  if (flowActive) return 'Answer the cards above'
  if (cardQuestions === 1) return 'Answer the question above'
  if (cardQuestions > 1) return 'Answer the questions above'
  if (working) return `${who} is still working. Wait for it, or press Stop.`
  return `Message ${who}…`
}
