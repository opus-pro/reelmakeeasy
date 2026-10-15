import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'no-as-error-in-catch'

const messageIds = {
  noAsError: 'noAsError',
} as const

const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prohibit "as Error" type assertions in catch blocks, recommend using ensureError() instead',
    },
    messages: {
      [messageIds.noAsError]:
        'Do not use "as Error" type assertion in catch blocks. Consider using ensureError() for proper error handling.',
    },
    schema: [],
    fixable: 'code',
  },
  defaultOptions: [],
  create(context) {
    // Helper function to check if we're inside a catch clause
    function isInCatchClause(node: TSESTree.Node): boolean {
      let parent = node.parent
      while (parent) {
        if (parent.type === 'CatchClause') {
          return true
        }
        parent = parent.parent
      }
      return false
    }

    return {
      // Check for "as Error" type assertions in catch blocks
      TSAsExpression(node: TSESTree.TSAsExpression) {
        if (
          isInCatchClause(node) &&
          node.typeAnnotation.type === 'TSTypeReference' &&
          node.typeAnnotation.typeName.type === 'Identifier' &&
          node.typeAnnotation.typeName.name === 'Error'
        ) {
          context.report({
            node,
            messageId: messageIds.noAsError,
          })
        }
      },
    }
  },
})

const noAsErrorInCatchRule: NxEslintRule = { RULE_NAME, rule }
export default noAsErrorInCatchRule
