import { ESLintUtils } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'only-english-comments'
const messageId = 'onlyEnglishComments'
// eslint-disable-next-line sonarjs/cognitive-complexity
const isValidChar = (code: number): boolean => {
  if (code < 127) return true

  if (code >= 128512 && code <= 128591) return true
  if (code >= 127744 && code <= 128511) return true
  if (code >= 128640 && code <= 128767) return true
  if (code >= 128768 && code <= 128895) return true
  if (code >= 128896 && code <= 129023) return true
  if (code >= 129024 && code <= 129279) return true
  if (code >= 129280 && code <= 129535) return true
  if (code >= 129536 && code <= 129647) return true
  if (code >= 129648 && code <= 129791) return true
  if (code >= 55296 && code <= 57343) return true

  return [...'⌘≠✅'].some((c) => c.charCodeAt(0) === code)
}

export const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: { description: 'Only allow English in js comments' },
    messages: {
      [messageId]: 'Only English comments are allowed, please write the comments in English',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    context
      .getSourceCode()
      .getAllComments()
      .forEach((comment) => {
        if ([...comment.value].map((c) => c.charCodeAt(0)).some((code) => !isValidChar(code))) {
          context.report({ node: comment, messageId })
        }
      })
    return {}
  },
})
const noEnglishComments: NxEslintRule = { RULE_NAME, rule }
export default noEnglishComments
