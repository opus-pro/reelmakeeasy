/**
 * Disallows `dependencies` or `devDependencies` fields in sub-package package.json files.
 * All dependencies must live in the root package.json.
 *
 * Applied via eslint.config.mjs to `apps/** /package.json` and `libs/** /package.json`.
 */

import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'no-sub-package-dependencies'
const messageId = 'noSubPackageDependencies'

/** Shape of JSONProperty node from ESLint JSON AST (key and parent chain). */
interface JSONPropertyNode {
  key?: { value: string }
  parent?: { parent?: { type: string } }
}

export const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: { description: 'Only root package.json can have dependencies or devDependencies' },
    messages: {
      [messageId]:
        'Sub-package package.json must not declare "{{field}}". Move all dependencies to the root package.json.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      JSONProperty(node: JSONPropertyNode) {
        const keyValue = node.key?.value
        if (keyValue !== 'dependencies' && keyValue !== 'devDependencies') {
          return
        }

        // Only flag top-level fields: JSONProperty -> JSONObjectExpression -> JSONExpressionStatement
        const parentType = node.parent?.parent?.type
        if (parentType !== 'JSONExpressionStatement') {
          return
        }

        context.report({ node: node as TSESTree.Node, messageId, data: { field: keyValue } })
      },
    }
  },
})

const noSubPackageDependencies: NxEslintRule = { RULE_NAME, rule }
export default noSubPackageDependencies
