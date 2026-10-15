import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'logger-import-restriction'

const messageId = 'restrictedLoggerImport'
const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Restrict logger imports to only come from @reelmakeeasy/common/logger/index.ts',
    },
    messages: {
      [messageId]:
        'Logger must be imported from "@reelmakeeasy/common/logger". Found import from: {{source}}',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    // List of prohibited logger-related imports
    const prohibitedLoggerSources = ['pino', 'winston', 'console', 'bunyan', 'log4js']

    // Allowed logger import sources
    const allowedLoggerSources = [
      '@reelmakeeasy/common/logger',
      './logger',
      '../logger',
      '../../logger',
      '../../../logger',
      '../../../../logger',
      '../../../../../logger',
    ]

    const isAllowedLoggerSource = (source: string): boolean => {
      return (
        allowedLoggerSources.includes(source) ||
        (source.endsWith('/logger') && !source.includes('@')) ||
        source.endsWith('/logger/index') ||
        source.endsWith('/logger')
      )
    }

    const checkImportDeclaration = (node: TSESTree.ImportDeclaration) => {
      if (!node.source.value || typeof node.source.value !== 'string') {
        return
      }

      const importSource = node.source.value
      const filename = context.filename

      // Allow prohibited logger imports in the central logger implementation directory
      if (filename.includes('libs/shared/common/src/logger')) {
        return
      }

      // Skip if it's an allowed logger source
      if (isAllowedLoggerSource(importSource)) {
        return
      }

      // Check if importing from prohibited logger sources
      if (prohibitedLoggerSources.includes(importSource)) {
        context.report({
          node: node.source,
          messageId,
          data: {
            source: importSource,
          },
        })
        return
      }

      // Also check if the source itself contains logger-related terms
      const lowerImportSource = importSource.toLowerCase()
      const sourceContainsLogger =
        lowerImportSource.includes('logger') &&
        !lowerImportSource.startsWith('./') &&
        !lowerImportSource.startsWith('../') &&
        !lowerImportSource.startsWith('@')

      if (sourceContainsLogger) {
        context.report({
          node: node.source,
          messageId,
          data: {
            source: importSource,
          },
        })
      }
    }

    return {
      ImportDeclaration: checkImportDeclaration,
    }
  },
})

const loggerImportRestrictionRule: NxEslintRule = { RULE_NAME, rule }
export default loggerImportRestrictionRule
