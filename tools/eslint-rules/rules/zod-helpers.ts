import { TSESTree } from '@typescript-eslint/utils'

type ZodPredicate = (node: TSESTree.Node) => boolean

const skipKeys = new Set(['loc', 'parent', 'range'])

/**
 * Determine whether an expression is likely a Zod schema
 */
export function containsZodOptional(node: TSESTree.Node): boolean {
  return containsZodNode(node, isOptionalCall)
}

export function containsZodUnknown(node: TSESTree.Node): boolean {
  return containsZodNode(node, isUnknownCall)
}

export function isLikelyZodSchema(node: TSESTree.Expression | TSESTree.PrivateIdentifier): boolean {
  if (node.type === 'PrivateIdentifier') {
    return false
  }

  if (isZodIdentifier(node)) {
    return true
  }

  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    return isZodMemberExpression(node.callee)
  }

  if (node.type === 'MemberExpression') {
    return isZodMemberExpression(node)
  }

  return false
}

function checkChildrenForPredicate(node: TSESTree.Node, predicate: ZodPredicate): boolean {
  const keys = Object.keys(node) as Array<keyof TSESTree.Node>

  for (const key of keys) {
    if (skipKeys.has(key as string)) {
      continue
    }

    const child = node[key]
    if (!child || typeof child !== 'object') {
      continue
    }

    if (hasPredicateInChild(child, predicate)) {
      return true
    }
  }

  return false
}

function containsZodNode(node: TSESTree.Node, predicate: ZodPredicate): boolean {
  if (predicate(node)) {
    return true
  }

  return checkChildrenForPredicate(node, predicate)
}

function hasPredicateInChild(child: unknown, predicate: ZodPredicate): boolean {
  if (Array.isArray(child)) {
    return child.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        'type' in item &&
        containsZodNode(item as TSESTree.Node, predicate),
    )
  }

  if (typeof child === 'object' && child !== null && 'type' in child) {
    return containsZodNode(child as TSESTree.Node, predicate)
  }

  return false
}

function isCommonZodMethod(name: string): boolean {
  const zodMethods = [
    'string',
    'number',
    'boolean',
    'bigint',
    'date',
    'symbol',
    'undefined',
    'null',
    'void',
    'any',
    'unknown',
    'never',
    'array',
    'object',
    'union',
    'intersection',
    'tuple',
    'record',
    'map',
    'set',
    'function',
    'lazy',
    'literal',
    'enum',
    'nativeEnum',
    'promise',
    'discriminatedUnion',
    'refine',
    'superRefine',
    'transform',
    'preprocess',
    'pipe',
    'nullable',
    'nullish',
    'optional',
    'default',
    'catch',
    'describe',
    'brand',
    'readonly',
    'min',
    'max',
    'length',
    'email',
    'url',
    'uuid',
    'regex',
    'trim',
    'toLowerCase',
    'toUpperCase',
    'startsWith',
    'endsWith',
    'datetime',
    'ip',
    'gt',
    'gte',
    'lt',
    'lte',
    'int',
    'positive',
    'nonnegative',
    'negative',
    'nonpositive',
    'multipleOf',
    'finite',
    'safe',
    'nonempty',
  ]
  return zodMethods.includes(name)
}

function isOptionalCall(node: TSESTree.Node): boolean {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') {
    return false
  }

  const { property, object } = node.callee
  return property.type === 'Identifier' && property.name === 'optional' && isLikelyZodSchema(object)
}

function isUnknownCall(node: TSESTree.Node): boolean {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') {
    return false
  }

  const { property, object } = node.callee
  return property.type === 'Identifier' && property.name === 'unknown' && isLikelyZodSchema(object)
}

function isZodIdentifier(node: TSESTree.Expression): boolean {
  return node.type === 'Identifier' && node.name === 'z'
}

function isZodMemberExpression(node: TSESTree.MemberExpression): boolean {
  const { object, property } = node

  if (isZodIdentifier(object)) {
    return true
  }

  if (property.type === 'Identifier' && isCommonZodMethod(property.name)) {
    return true
  }

  return isLikelyZodSchema(object)
}
