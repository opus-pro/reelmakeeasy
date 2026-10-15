import { countWords } from '@reelmakeeasy/common/utils/text'

/**
 * Deterministic transcript-fidelity checks that run BEFORE the LLM validator.
 *
 * This started life as a truncation-only check: fail when `asrWords / scriptWords`
 * fell under a floor. That shape is blind to TTS *insertions*, because inserted
 * speech RAISES the ratio and so clears the floor cleanly. One video shipped a
 * voiceover containing an unscripted line ("Travel how you see the world.") at a
 * ratio of 1.096 against a 0.9 floor, and the only thing that noticed was a
 * post-hoc advisory check whose verdict nothing acted on.
 *
 * Insertions are now caught by aligning script and ASR word sequences (LCS) and
 * looking for a contiguous run of ASR-only words that no dropped script word can
 * account for. That "account for" rule is what keeps the check quiet on ordinary
 * ASR drift: a vocalized expansion ("$500" -> "five hundred dollars", "(NREM)" ->
 * ", or NREM,") drops a script token that visibly needs speaking out, whereas a
 * hallucination inserts words with nothing dropped to justify them.
 *
 * This gate sits on the hot path for every Story Mode voiceover and a failure
 * costs a full TTS re-render, so every threshold here is deliberately
 * conservative -- it is tuned to miss a marginal case rather than to bill a
 * spurious retry across the whole platform.
 */

/** ASR must cover at least this share of the script, else it looks truncated. */
export const MIN_WORD_COVERAGE_RATIO = 0.9

/**
 * Coarse duplication net, used ONLY when the transcript cannot be aligned (no
 * usable word boundaries, or too large -- see MAX_ALIGNMENT_WORDS). Alignment
 * catches duplication far more precisely, since a repeated script is one enormous
 * unaccounted-for insertion run. Applying this ratio to alignable input would only
 * add false positives: legitimately vocalizing several numbers ("$1,500" ->
 * "one thousand five hundred dollars") can push a perfectly valid transcript past it.
 */
export const MAX_WORD_INFLATION_RATIO = 1.5

/** A run of ASR-only words at least this long is treated as inserted speech. */
export const MIN_INSERTED_RUN_WORDS = 4

/**
 * ...and it must carry at least this many non-function words, so a run of pure
 * connective tissue ("and to the a") can never trip the gate on its own.
 */
const MIN_INSERTED_RUN_CONTENT_WORDS = 2

/**
 * A single-word run this long is never normal delivery unless the script asks for
 * it. Keep this deliberately high so ordinary emphasis ("go, go, go") stays valid.
 */
const MIN_PATHOLOGICAL_WORD_RUN = 8

/** The generated take must add at least this many repeats beyond the scripted run. */
const MIN_EXCESS_REPEATED_WORDS = 5

/** Alignment is O(n*m); scripts are capped well below this (5000 chars / 420-word chunks). */
const MAX_ALIGNMENT_WORDS = 1500

/**
 * CJK ideographs, Kana, Hangul and Thai -- the same ranges `countWords` treats as
 * one character per word. Whitespace tokens carry no word boundaries there, so
 * insertion detection is skipped rather than guessed at.
 */
const NON_SPACE_SEPARATED_PATTERN = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯฀-๿]/

/** A dropped script token holding a digit or symbol is one the TTS has to speak out. */
const VOCALIZABLE_TOKEN_PATTERN = /[\d$%&@#+=<>^~|/\\*()[\]{}]/

/**
 * An initialism is spoken letter-by-letter or respelled, so a dropped one is also a
 * token the TTS has to speak out: "KTVX" -> "K T V X", "HTML" -> "aitch tee em el".
 * Both expand one script token into four ASR words, which is exactly the shape the
 * insertion thresholds are tuned to catch, so without this they read as inserted
 * speech (and on the UIP preview-handoff path the script most likely to
 * hit this is the one carrying an inline `{KTVX|kay tee vee ex}` pronunciation
 * marker, since such a marker is itself a reason the handoff exists).
 *
 * Two or more letters, no lowercase, so ordinary capitalized words ("Photosynthesis")
 * and sentence-initial words are untouched.
 */
const INITIALISM_TOKEN_PATTERN = /^[^a-z]*[A-Z][^a-z]*[A-Z][^a-z]*$/

/**
 * How many ASR words a dropped token is allowed to expand into before the run stops
 * counting as its vocalization.
 *
 * Without a ceiling, a hallucination that runs straight on from a genuine expansion
 * shares one insertion run with it ("K T V X and then the story begins") and
 * exempting the run would hide the hallucination too. Speaking a token out loud is
 * bounded by its characters, but the ratio depends on what kind of token it is:
 * digits inflate ("$1,234,567" -> "one million two hundred thirty four thousand five
 * hundred sixty seven", 11 words for 7 digits) while letters do not ("HTML" ->
 * "aitch tee em el", 4 for 4). Hence two budgets, both with slack, and an absolute
 * ceiling so a pathologically long token cannot hand out an unbounded allowance.
 */
const VOCALIZATION_SLACK_WORDS = 2
const DIGIT_VOCALIZATION_WORDS_PER_CHAR = 2
const MAX_VOCALIZATION_WORDS = 20

/**
 * Past this length a run must be made *entirely* of recognisable vocalization words.
 * Long allowances exist so spoken numbers fit, and this stops one from absorbing
 * invented speech that happens to sit beside a long numeric token.
 *
 * Below it the test is weaker but not absent: the run may contain words this
 * vocabulary does not know -- which is what a non-English expansion looks like
 * ("mil doscientos treinta y cuatro") -- yet it must not read as English prose.
 * Without that second half, any six words could stand in for a dropped `$500`.
 */
const VOCALIZATION_LENGTH_ONLY_WORDS = 6

/**
 * Letter names, for an initialism read out rather than spelled: "HTML" -> "aitch tee
 * em el". Single letters are matched separately, so "KTVX" -> "K T V X" is covered
 * without listing the alphabet twice. "oh" doubles as a number word and lives there.
 */
const LETTER_NAME_WORDS = new Set([
  'aitch',
  'ar',
  'bee',
  'cee',
  'cue',
  'dee',
  'double-u',
  'ee',
  'eff',
  'el',
  'em',
  'en',
  'ess',
  'ex',
  'gee',
  'jay',
  'kay',
  'pee',
  'tee',
  'vee',
  'wye',
  'zed',
  'zee',
])

const NUMBER_WORDS = new Set([
  'billion',
  'billions',
  'cent',
  'cents',
  'dollar',
  'dollars',
  'eight',
  'eighteen',
  'eighty',
  'eleven',
  'fifteen',
  'fifty',
  'five',
  'forty',
  'four',
  'fourteen',
  'hundred',
  'hundreds',
  'million',
  'millions',
  'nine',
  'nineteen',
  'ninety',
  'oh',
  'one',
  'percent',
  'point',
  'seven',
  'seventeen',
  'seventy',
  'six',
  'sixteen',
  'sixty',
  'ten',
  'thirteen',
  'thirty',
  'thousand',
  'thousands',
  'three',
  'trillion',
  'twelve',
  'twenty',
  'two',
  'zero',
])

const FILLER_WORDS = new Set([
  'ah',
  'ahh',
  'er',
  'erm',
  'hmm',
  'mm',
  'mmm',
  'uh',
  'uhh',
  'um',
  'umm',
])

const FUNCTION_WORDS = new Set([
  'a',
  'about',
  'all',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'down',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'out',
  'over',
  'she',
  'should',
  'so',
  'some',
  'than',
  'that',
  'the',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'up',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
])

interface AlignToken {
  norm: string
  raw: string
}

type EditOp =
  | { asrIndex: number; kind: 'insert' }
  | { kind: 'delete'; scriptIndex: number }
  | { kind: 'match' }

/** Find the worst single-word run that substantially exceeds the same scripted run. */
function findPathologicalWordRun(
  scriptTokens: AlignToken[],
  asrTokens: AlignToken[],
): undefined | { length: number; scriptedLength: number; token: AlignToken } {
  const scriptedRuns = longestWordRuns(scriptTokens)
  const spokenRuns = longestWordRuns(asrTokens)
  let worst: undefined | { length: number; scriptedLength: number; token: AlignToken }

  for (const [word, spokenRun] of spokenRuns) {
    const scriptedLength = scriptedRuns.get(word)?.length ?? 0
    if (
      spokenRun.length >= MIN_PATHOLOGICAL_WORD_RUN &&
      spokenRun.length >= scriptedLength + MIN_EXCESS_REPEATED_WORDS &&
      (!worst || spokenRun.length > worst.length)
    ) {
      worst = {
        length: spokenRun.length,
        scriptedLength,
        token: spokenRun.token,
      }
    }
  }

  return worst
}

/** Record the longest consecutive run for each normalized word. */
function longestWordRuns(tokens: AlignToken[]): Map<string, { length: number; token: AlignToken }> {
  const longest = new Map<string, { length: number; token: AlignToken }>()
  let current = 0
  let previous = ''

  for (const token of tokens) {
    current = token.norm === previous ? current + 1 : 1
    previous = token.norm
    if (current > (longest.get(token.norm)?.length ?? 0)) {
      longest.set(token.norm, { length: current, token })
    }
  }

  return longest
}

/**
 * Split into comparable tokens: punctuation and casing dropped (the LLM prompts
 * already treat those as non-issues), fillers removed so an ASR "um" can never read
 * as inserted speech. `raw` is kept both to quote a flagged span verbatim and to
 * spot dropped tokens the TTS had to vocalize.
 */
function tokenize(text: string): AlignToken[] {
  const tokens: AlignToken[] = []
  for (const raw of text.split(/\s+/)) {
    const norm = raw.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
    if (!norm || FILLER_WORDS.has(norm)) {
      continue
    }
    tokens.push({ norm, raw })
  }
  return tokens
}

/**
 * Forward LCS DP over token suffixes, then a forward walk to emit the edit script.
 * `insert` = present in ASR only, `delete` = present in script only.
 */
function diffOps(script: AlignToken[], asr: AlignToken[]): EditOp[] {
  const scriptLength = script.length
  const asrLength = asr.length
  const width = asrLength + 1
  const lcs = new Uint16Array((scriptLength + 1) * width)

  for (let i = scriptLength - 1; i >= 0; i--) {
    for (let j = asrLength - 1; j >= 0; j--) {
      lcs[i * width + j] =
        script[i].norm === asr[j].norm
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }

  const ops: EditOp[] = []
  let i = 0
  let j = 0
  while (i < scriptLength && j < asrLength) {
    if (script[i].norm === asr[j].norm) {
      ops.push({ kind: 'match' })
      i++
      j++
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ kind: 'delete', scriptIndex: i })
      i++
    } else {
      ops.push({ asrIndex: j, kind: 'insert' })
      j++
    }
  }
  while (i < scriptLength) {
    ops.push({ kind: 'delete', scriptIndex: i })
    i++
  }
  while (j < asrLength) {
    ops.push({ asrIndex: j, kind: 'insert' })
    j++
  }
  return ops
}

/** Script tokens dropped in the contiguous delete runs immediately around [start, end). */
function adjacentDeletedTokens(
  ops: EditOp[],
  start: number,
  end: number,
  script: AlignToken[],
): AlignToken[] {
  const deleted: AlignToken[] = []
  for (let k = start - 1; k >= 0 && ops[k].kind === 'delete'; k--) {
    deleted.push(script[(ops[k] as { scriptIndex: number }).scriptIndex])
  }
  for (let k = end; k < ops.length && ops[k].kind === 'delete'; k++) {
    deleted.push(script[(ops[k] as { scriptIndex: number }).scriptIndex])
  }
  return deleted
}

/**
 * ASR-only runs that no dropped script token accounts for.
 *
 * A run sitting next to a dropped token containing a digit or symbol ("$1,500",
 * "(NREM)", "&") or a dropped initialism ("KTVX", "HTML") is a vocalization of that
 * token rather than new content, so it is skipped. The exemption is deliberately
 * narrow: exempting every run that merely touches a deletion would let any
 * hallucination that also swallowed one script word escape the gate. Plain word
 * substitutions need no exemption -- they yield runs far shorter than
 * MIN_INSERTED_RUN_WORDS.
 */
function countContentWords(run: AlignToken[]): number {
  return run.filter((token) => !FUNCTION_WORDS.has(token.norm)).length
}

function findUnaccountedInsertionRuns(
  ops: EditOp[],
  script: AlignToken[],
  asr: AlignToken[],
): AlignToken[][] {
  const runs: AlignToken[][] = []
  let index = 0
  while (index < ops.length) {
    if (ops[index].kind !== 'insert') {
      index++
      continue
    }
    let end = index
    while (end < ops.length && ops[end].kind === 'insert') {
      end++
    }
    // Only as many words as the adjacent dropped tokens could plausibly be spoken
    // as. A longer run carries more than their vocalization -- e.g. an invented
    // phrase continuing straight out of a spelled-out initialism -- so it is judged
    // on the thresholds like any other insertion.
    const run = ops.slice(index, end).map((op) => asr[(op as { asrIndex: number }).asrIndex])
    if (!isExplainedByVocalization(run, adjacentDeletedTokens(ops, index, end, script))) {
      runs.push(run)
    }
    index = end
  }
  return runs
}

/**
 * Whether an ASR-only run is just the adjacent dropped tokens being spoken out.
 *
 * Two hurdles, because each alone lets something through. The **budget** stops a run
 * claiming more words than those tokens could produce -- that is what catches an
 * invented phrase continuing straight out of a spelled-out initialism. But a long
 * numeric token earns a large budget legitimately, so the run must also **look** like
 * a vocalization: entirely made of number words and letter names once it is long
 * enough that only a spoken number could justify it, and short of that at least free
 * of English prose, so six arbitrary words cannot stand in for a dropped `$500`.
 *
 * The prose test, rather than requiring the vocabulary outright, is what keeps a
 * non-English expansion valid: its words are unknown here, but they are not English
 * function words either.
 */
function isExplainedByVocalization(run: AlignToken[], droppedTokens: AlignToken[]): boolean {
  const budget = droppedTokens
    .filter(isVocalizableToken)
    .reduce((total, token) => total + vocalizationWordBudget(token), 0)
  if (budget === 0 || run.length > budget) {
    return false
  }
  if (run.length > VOCALIZATION_LENGTH_ONLY_WORDS) {
    return run
      .filter((token) => !FUNCTION_WORDS.has(token.norm))
      .every((token) => isVocalizationWord(token))
  }
  return run.every((token) => isVocalizationWord(token) || !FUNCTION_WORDS.has(token.norm))
}

/** A word a dropped token can plausibly have been spoken as. */
function isVocalizableToken(token: AlignToken): boolean {
  return VOCALIZABLE_TOKEN_PATTERN.test(token.raw) || INITIALISM_TOKEN_PATTERN.test(token.raw)
}

function isVocalizationWord(token: AlignToken): boolean {
  return (
    NUMBER_WORDS.has(token.norm) || LETTER_NAME_WORDS.has(token.norm) || /^[a-z]$/.test(token.norm)
  )
}

/**
 * Alphanumeric characters are what gets spoken out, at a rate set by whether the
 * token holds digits, plus slack -- and never more than the absolute ceiling.
 */
function vocalizationWordBudget(token: AlignToken): number {
  const speakableChars = token.raw.match(/[\dA-Za-z]/g)?.length ?? 0
  const perChar = /\d/.test(token.raw) ? DIGIT_VOCALIZATION_WORDS_PER_CHAR : 1
  return Math.min(MAX_VOCALIZATION_WORDS, speakableChars * perChar + VOCALIZATION_SLACK_WORDS)
}

/**
 * Deterministic pre-check for TTS output fidelity: detects a truncated ASR
 * transcript and inserted speech absent from the script. Runs before (and
 * independently of) the LLM validator so a flaky model call cannot silently wave a
 * bad take through.
 */
export function checkTranscriptFidelity(
  originalScript: string,
  asrTranscript: string,
): { issues: string[]; isValid: boolean } {
  // Language-aware counts: `countWords` counts each CJK/Thai character as a word,
  // so a multi-line Chinese or Japanese script no longer reads as truncated purely
  // because its lines contain no spaces.
  const scriptWordCount = countWords(originalScript)
  const asrWordCount = countWords(asrTranscript)
  if (scriptWordCount === 0) {
    return { isValid: true, issues: [] }
  }
  const ratio = asrWordCount / scriptWordCount

  if (ratio < MIN_WORD_COVERAGE_RATIO) {
    return {
      isValid: false,
      issues: [
        `ASR transcript appears truncated: ${asrWordCount} words vs ${scriptWordCount} in original (${Math.round(ratio * 100)}% coverage, minimum ${MIN_WORD_COVERAGE_RATIO * 100}%)`,
      ],
    }
  }

  const scriptTokens = tokenize(originalScript)
  const asrTokens = tokenize(asrTranscript)
  const repeatedRun = findPathologicalWordRun(scriptTokens, asrTokens)
  if (repeatedRun) {
    return {
      isValid: false,
      issues: [
        `ASR transcript contains a pathological repetition: "${repeatedRun.token.raw}" repeated ${repeatedRun.length} times consecutively (longest scripted run: ${repeatedRun.scriptedLength})`,
      ],
    }
  }

  const alignable =
    scriptTokens.length > 0 &&
    asrTokens.length > 0 &&
    scriptTokens.length <= MAX_ALIGNMENT_WORDS &&
    asrTokens.length <= MAX_ALIGNMENT_WORDS &&
    !NON_SPACE_SEPARATED_PATTERN.test(originalScript) &&
    !NON_SPACE_SEPARATED_PATTERN.test(asrTranscript)

  if (!alignable) {
    if (ratio > MAX_WORD_INFLATION_RATIO) {
      return {
        isValid: false,
        issues: [
          `ASR transcript appears to contain duplicated or extra speech: ${asrWordCount} words vs ${scriptWordCount} in original (${Math.round(ratio * 100)}% of the script, maximum ${MAX_WORD_INFLATION_RATIO * 100}%)`,
        ],
      }
    }
    return { isValid: true, issues: [] }
  }

  const insertedRuns = findUnaccountedInsertionRuns(
    diffOps(scriptTokens, asrTokens),
    scriptTokens,
    asrTokens,
  )
  const worstRun = insertedRuns
    .filter(
      (run) =>
        run.length >= MIN_INSERTED_RUN_WORDS &&
        countContentWords(run) >= MIN_INSERTED_RUN_CONTENT_WORDS,
    )
    .reduce<
      AlignToken[] | undefined
    >((worst, run) => (worst && worst.length >= run.length ? worst : run), undefined)

  if (worstRun) {
    const spoken = worstRun.map((token) => token.raw).join(' ')
    return {
      isValid: false,
      issues: [
        `ASR transcript contains ${worstRun.length} consecutive words absent from the script (possible TTS hallucination): "${spoken}"`,
      ],
    }
  }

  return { isValid: true, issues: [] }
}
