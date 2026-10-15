import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

// NOTE: The rule will be available in ESLint configs as "@nx/workspace-no-enum-in-dts"
const RULE_NAME = 'only-enum-in-enum-ts'

const messageId = 'defaultMsgId'
const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Only enum declarations are allowed in *.enum.ts files.',
    },
    messages: {
      [messageId]: 'Only enum declarations are allowed in *.enum.ts files.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const returnIfInEnumTs = (node: TSESTree.Node): void => {
      if (context.filename.endsWith('.enum.ts')) {
        context.report({ node, messageId })
      }
    }
    return {
      TSInterfaceDeclaration: (node: TSESTree.TSInterfaceDeclaration) => returnIfInEnumTs(node),
      TSTypeAliasDeclaration: (node: TSESTree.TSTypeAliasDeclaration) => returnIfInEnumTs(node),
      TSClassDeclaration: (node: TSESTree.ClassDeclaration) => returnIfInEnumTs(node),
      TSFunctionDeclaration: (node: TSESTree.FunctionDeclaration) => returnIfInEnumTs(node),
      TSVariableDeclaration: (node: TSESTree.VariableDeclaration) => returnIfInEnumTs(node),
      TSImportDeclaration: (node: TSESTree.ImportDeclaration) => returnIfInEnumTs(node),
    }
  },
})

const onlyEnumInEnumTsRule: NxEslintRule = { RULE_NAME, rule }
export default onlyEnumInEnumTsRule
