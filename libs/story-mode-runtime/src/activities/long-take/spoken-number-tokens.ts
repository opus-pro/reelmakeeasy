const SMALL_NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const

const TENS_NUMBER_WORDS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const

const NUMBER_SCALES = [
  { value: 1_000_000_000, word: 'billion' },
  { value: 1_000_000, word: 'million' },
  { value: 1_000, word: 'thousand' },
] as const

export function expandNumericPercentageToken(token: string): null | string[] {
  const match = token.match(/^(\d[\d,]*)(?:\.(\d+))?%[^\p{L}\p{N}]*$/u)
  if (!match) {
    return null
  }

  const wholeNumber = Number(match[1].replaceAll(',', ''))
  if (!Number.isSafeInteger(wholeNumber) || wholeNumber >= 1_000_000_000_000) {
    return null
  }

  const decimalDigits = match[2]?.replace(/0+$/, '') || ''
  return [
    ...integerToEnglishTokens(wholeNumber),
    ...(decimalDigits
      ? ['point', ...[...decimalDigits].map((digit) => SMALL_NUMBER_WORDS[Number(digit)])]
      : []),
    'percent',
  ]
}

function integerToEnglishTokens(value: number): string[] {
  if (value < 20) {
    return [SMALL_NUMBER_WORDS[value]]
  }
  if (value < 100) {
    const tens = Math.floor(value / 10)
    const remainder = value % 10
    return remainder === 0
      ? [TENS_NUMBER_WORDS[tens]]
      : [TENS_NUMBER_WORDS[tens], SMALL_NUMBER_WORDS[remainder]]
  }
  if (value < 1_000) {
    const hundreds = Math.floor(value / 100)
    const remainder = value % 100
    return remainder === 0
      ? [SMALL_NUMBER_WORDS[hundreds], 'hundred']
      : [SMALL_NUMBER_WORDS[hundreds], 'hundred', ...integerToEnglishTokens(remainder)]
  }
  for (const scale of NUMBER_SCALES) {
    if (value >= scale.value) {
      const leading = Math.floor(value / scale.value)
      const remainder = value % scale.value
      return remainder === 0
        ? [...integerToEnglishTokens(leading), scale.word]
        : [...integerToEnglishTokens(leading), scale.word, ...integerToEnglishTokens(remainder)]
    }
  }
  return [String(value)]
}
