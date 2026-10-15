import { canonicalizeScriptLanguage, ENGLISH_ONLY_SCRIPT_LANGUAGE } from './normalization'

describe('canonicalizeScriptLanguage (English only for now)', () => {
  it('keeps English', () => {
    expect(canonicalizeScriptLanguage('en')).toBe(ENGLISH_ONLY_SCRIPT_LANGUAGE)
    expect(canonicalizeScriptLanguage('en-US')).toBe(ENGLISH_ONLY_SCRIPT_LANGUAGE)
  })

  it('pins every other valid language tag to English until caption fonts cover it', () => {
    for (const tag of ['es', 'pt-BR', 'zh_CN', 'ja', ' de ']) {
      expect(canonicalizeScriptLanguage(tag)).toBe(ENGLISH_ONLY_SCRIPT_LANGUAGE)
    }
  })

  it('leaves unset and invalid values empty', () => {
    expect(canonicalizeScriptLanguage(undefined)).toBe('')
    expect(canonicalizeScriptLanguage('')).toBe('')
    expect(canonicalizeScriptLanguage('not a language tag!')).toBe('')
  })
})
