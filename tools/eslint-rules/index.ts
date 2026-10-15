/**
 * Import your custom workspace rules at the top of this file.
 *
 * For example:
 *
 * import * as noEnumInDtsRule from './rules/no-enum-in-dts'
 *
 * In order to quickly get started with writing rules you can use the
 * following generator command and provide your desired rule name:
 *
 * ```sh
 * npx nx g @nx/eslint:workspace-rule {{ NEW_RULE_NAME }}
 * ```
 */

import loggerImportRestrictionRule from './rules/logger-import-restriction'
import loggerNamingRule from './rules/logger-naming'
import loggerNoDroppedArgsRule from './rules/logger-no-dropped-args'
import noExportInternalRule from './rules/no-export-internal'
import noMockGlobalLoggerRule from './rules/no-mock-global-logger'
import noPiiFieldAccessRule from './rules/no-pii-field-access'
import noSubPackageDependenciesRule from './rules/no-sub-package-dependencies'
import noZodOptionalRule from './rules/no-zod-optional'
import noZodUnknownRule from './rules/no-zod-unknown'
import onlyEnglishComments from './rules/only-english-comments'
import onlyEnumInEnumTsRule from './rules/only-enum-in-enum-ts'
import noAsErrorInCatchRule from './rules/prefer-ensure-error-in-catch'
import preferStructuredLoggerErrorRule from './rules/prefer-structured-logger-error'
import { NxEslintRule } from './type'

function registerRules(ruleModules: NxEslintRule[]): { rules: Record<string, unknown> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, any> = {}
  ruleModules.forEach((item) => {
    const { RULE_NAME, rule } = item
    rules[RULE_NAME] = rule
  })
  return { rules }
}

module.exports = registerRules([
  loggerImportRestrictionRule,
  loggerNamingRule,
  loggerNoDroppedArgsRule,
  noMockGlobalLoggerRule,
  onlyEnumInEnumTsRule,
  onlyEnglishComments,
  noPiiFieldAccessRule,
  noAsErrorInCatchRule,
  noSubPackageDependenciesRule,
  noZodOptionalRule,
  noZodUnknownRule,
  preferStructuredLoggerErrorRule,
  noExportInternalRule,
])
