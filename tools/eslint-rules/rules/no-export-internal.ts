import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'no-export-internal'

const messageId = 'noExportInternal'
const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow exporting functions or variables that start with "internal"',
    },
    messages: {
      [messageId]:
        'Functions or variables starting with "internal" should not be exported. Consider renaming or removing the export.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const checkInternalExport = (node: TSESTree.Node, name: string) => {
      if (name.startsWith('internal')) {
        context.report({
          node,
          messageId,
        })
      }
    }

    return {
      // Handle named exports: export { internalFunction }
      ExportNamedDeclaration(node: TSESTree.ExportNamedDeclaration) {
        if (node.specifiers) {
          node.specifiers.forEach((specifier) => {
            if (specifier.type === 'ExportSpecifier' && specifier.exported.type === 'Identifier') {
              checkInternalExport(specifier, specifier.exported.name)
            }
          })
        }

        // Handle direct named exports: export function internalFunction() {}
        if (node.declaration) {
          if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
            checkInternalExport(node.declaration, node.declaration.id.name)
          } else if (node.declaration.type === 'VariableDeclaration') {
            node.declaration.declarations.forEach((declarator) => {
              if (declarator.id.type === 'Identifier') {
                checkInternalExport(declarator, declarator.id.name)
              }
            })
          } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
            checkInternalExport(node.declaration, node.declaration.id.name)
          } else if (node.declaration.type === 'TSInterfaceDeclaration') {
            checkInternalExport(node.declaration, node.declaration.id.name)
          } else if (node.declaration.type === 'TSTypeAliasDeclaration') {
            checkInternalExport(node.declaration, node.declaration.id.name)
          } else if (node.declaration.type === 'TSEnumDeclaration') {
            checkInternalExport(node.declaration, node.declaration.id.name)
          }
        }
      },

      // Handle default exports: export default internalFunction
      ExportDefaultDeclaration(node: TSESTree.ExportDefaultDeclaration) {
        if (node.declaration.type === 'Identifier') {
          checkInternalExport(node, node.declaration.name)
        } else if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          checkInternalExport(node.declaration, node.declaration.id.name)
        }
      },

      // Handle export assignments: export = internalFunction
      TSExportAssignment(node: TSESTree.TSExportAssignment) {
        if (node.expression.type === 'Identifier') {
          checkInternalExport(node, node.expression.name)
        }
      },
    }
  },
})

const noExportInternalRule: NxEslintRule = { RULE_NAME, rule }
export default noExportInternalRule
