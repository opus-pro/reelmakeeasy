import { ESLintUtils, TSESTree } from '@typescript-eslint/utils'

import { NxEslintRule } from '../type'

const RULE_NAME = 'no-pii-field-access'

const MESSAGE_SUB_FIELD = 'noPiiSubFieldAccess'
const MESSAGE_WHOLE_READ = 'noPiiWholeRead'
const MESSAGE_DESTRUCTURE_PII = 'noPiiDestructure'
const MESSAGE_DESTRUCTURE_SUB_FIELD = 'noPiiDestructureSubField'

const PII_SUB_FIELDS = new Set(['email', 'ip', 'name'])

const rule = ESLintUtils.RuleCreator(() => __filename)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct access to pii fields (email, ip, name) from request context',
    },
    messages: {
      [MESSAGE_SUB_FIELD]:
        'Do not read pii.{{field}} directly. PII fields in the request context are being removed. Use the encrypted PII block and decrypt where explicitly needed.',
      [MESSAGE_WHOLE_READ]:
        'Do not read the pii object directly. PII fields in the request context are being removed. Use the encrypted PII block and decrypt where explicitly needed.',
      [MESSAGE_DESTRUCTURE_PII]:
        'Do not destructure pii from the request context. PII fields are being removed. Use the encrypted PII block and decrypt where explicitly needed.',
      [MESSAGE_DESTRUCTURE_SUB_FIELD]:
        'Do not destructure {{field}} from pii. PII fields in the request context are being removed. Use the encrypted PII block and decrypt where explicitly needed.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    /**
     * Check whether a MemberExpression whose property is "pii" is used as
     * a *read* (right-hand side) rather than a *write* (object-literal shorthand
     * or property assignment on the left-hand side of `=`).
     *
     * We allow:
     *   - Object literal properties:  `{ pii: { email: ... } }`
     *   - Assignment targets:         `ctx.pii = { ... }`
     *   - Type definitions:           handled by file-level ignores in eslint config
     */
    function isPiiWrite(node: TSESTree.MemberExpression): boolean {
      const parent = node.parent

      // `ctx.pii = value` - assignment left-hand side
      if (parent?.type === 'AssignmentExpression' && parent.left === node) {
        return true
      }

      return false
    }

    /**
     * Check if a Property node inside an ObjectPattern has key name matching `target`.
     * Handles both `{ pii }` (shorthand) and `{ pii: alias }` forms.
     */
    function isDestructuredKey(
      prop: TSESTree.Property | TSESTree.RestElement,
      target: string,
    ): prop is TSESTree.Property {
      return prop.type === 'Property' && prop.key.type === 'Identifier' && prop.key.name === target
    }

    return {
      MemberExpression(node: TSESTree.MemberExpression) {
        const prop = node.property
        if (prop.type !== 'Identifier') {
          return
        }

        // Case 1: *.pii.email / *.pii?.ip / *.pii?.name - sub-field access
        if (PII_SUB_FIELDS.has(prop.name)) {
          const obj = node.object
          if (obj.type !== 'MemberExpression') {
            return
          }
          const objProp = obj.property
          if (objProp.type === 'Identifier' && objProp.name === 'pii') {
            context.report({
              node,
              messageId: MESSAGE_SUB_FIELD,
              data: { field: prop.name },
            })
          }
          return
        }

        // Case 2: *.pii - whole pii object read (e.g. `const p = ctx.pii`)
        if (prop.name === 'pii') {
          // Skip writes (assignments to pii)
          if (isPiiWrite(node)) {
            return
          }

          // Skip if the parent is accessing a sub-field (already caught by Case 1)
          const parent = node.parent
          if (parent?.type === 'MemberExpression' && parent.object === node) {
            return
          }

          // This is a standalone read of the pii object
          context.report({
            node,
            messageId: MESSAGE_WHOLE_READ,
          })
        }
      },

      // Case 3: const { pii } = ctx / const { pii: p } = ctx / const { pii: { email } } = ctx
      // Catches destructuring of the pii object from any parent.
      'ObjectPattern > Property'(node: TSESTree.Property) {
        if (node.key.type !== 'Identifier' || node.key.name !== 'pii') {
          return
        }

        // Skip object literal construction: { pii: { email: 'x' } }
        // ObjectPattern appears only in destructuring (VariableDeclarator, AssignmentPattern, params).
        // If the parent ObjectPattern is on the LEFT side we're destructuring - report it.
        context.report({
          node,
          messageId: MESSAGE_DESTRUCTURE_PII,
        })
      },

      // Case 4: const { email } = ctx.pii / const { ip, name } = reqCtx.pii
      // Catches destructuring sub-fields directly from a .pii member expression.
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        // init must be *.pii (MemberExpression with property 'pii')
        const init = node.init
        if (
          !init ||
          init.type !== 'MemberExpression' ||
          init.property.type !== 'Identifier' ||
          init.property.name !== 'pii'
        ) {
          return
        }

        // id must be an ObjectPattern (destructuring)
        if (node.id.type !== 'ObjectPattern') {
          return
        }

        // Report each destructured PII sub-field
        for (const prop of node.id.properties) {
          if (
            isDestructuredKey(prop, 'email') ||
            isDestructuredKey(prop, 'ip') ||
            isDestructuredKey(prop, 'name')
          ) {
            context.report({
              node: prop,
              messageId: MESSAGE_DESTRUCTURE_SUB_FIELD,
              data: { field: (prop.key as TSESTree.Identifier).name },
            })
          }
        }
      },
    }
  },
})

const noPiiFieldAccessRule: NxEslintRule = { RULE_NAME, rule }
export default noPiiFieldAccessRule
