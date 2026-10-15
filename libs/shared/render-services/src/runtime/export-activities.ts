import { AbstractService } from './abstract'

type ActivityConstructor = new () => AbstractService

type ActivityMethods<T extends AbstractService> = {
  [K in Exclude<keyof T, keyof AbstractService> as K extends string
    ? K extends Uncapitalize<K & string>
      ? T[K] extends (...args: never[]) => unknown
        ? K
        : never
      : never
    : never]: T[K]
}

type MergedActivities<Cs extends ActivityConstructor[]> = Cs extends [
  infer C extends ActivityConstructor,
  ...infer Rest extends ActivityConstructor[],
]
  ? ActivityMethods<InstanceType<C>> & MergedActivities<Rest>
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {}

function findDefiningProto(instance: AbstractService, name: string): null | object {
  let proto: null | object = Object.getPrototypeOf(instance)
  while (proto && proto !== AbstractService.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, name)) {
      return proto
    }
    proto = Object.getPrototypeOf(proto)
  }
  return null
}

type Registration = { clsName: string; defProto: object }

function isProtoAncestor(ancestor: object, descendant: object): boolean {
  let proto: null | object = Object.getPrototypeOf(descendant)
  while (proto) {
    if (proto === ancestor) {
      return true
    }
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

function resolveConflict(
  name: string,
  incoming: Registration,
  existing: Registration,
): null | Registration {
  if (existing.defProto === incoming.defProto) {
    return null
  }
  if (isProtoAncestor(incoming.defProto, existing.defProto)) {
    return null
  }
  if (isProtoAncestor(existing.defProto, incoming.defProto)) {
    return incoming
  }
  throw new Error(`Duplicate activity "${name}" from ${existing.clsName} and ${incoming.clsName}`)
}

/**
 * Returns true when proto belongs to AbstractService itself (not a subclass).
 * Checks by constructor name to handle cases where multiple bundle instances of
 * AbstractService are loaded (e.g. tsup multi-entry builds duplicate shared classes).
 */
function isAbstractServiceProto(proto: null | object): boolean {
  if (!proto || proto === Object.prototype) return true
  const ctor = (proto as { constructor?: { name?: string } }).constructor
  return ctor?.name === 'AbstractService' || proto === AbstractService.prototype
}

/**
 * Binds all camelCase prototype methods (i.e. @DefineActivity-decorated activities) to the
 * instance. Walks the prototype chain up to (not including) AbstractService.prototype.
 *
 * Uses Object.getOwnPropertyDescriptor instead of instance[key] to avoid triggering
 * getter accessors (e.g. currentContext) during the walk.
 */
export function bindActivities<T extends AbstractService>(instance: T): ActivityMethods<T> {
  const result: Record<string, unknown> = {}
  let proto: null | object = Object.getPrototypeOf(instance)

  while (proto && !isAbstractServiceProto(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue
      if (key.length > 0 && key[0] === key[0]!.toUpperCase()) continue // PascalCase -> workflow entry, skip
      if (key in result) continue // keep the most-derived override
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      if (descriptor && typeof descriptor.value === 'function') {
        result[key] = (descriptor.value as Function).bind(instance)
      }
    }
    proto = Object.getPrototypeOf(proto)
  }

  return result as ActivityMethods<T>
}

/**
 * Merges activities from multiple service classes into a single registry object,
 * ready to pass as `activities` to `registerWorker`.
 *
 * - Excludes PascalCase methods (workflow entry points).
 * - Excludes methods inherited from AbstractService itself.
 * - Resolves inherited duplicates by prototype ancestry; throws on unrelated conflicts.
 */
export function exportActivities<Cs extends ActivityConstructor[]>(
  ...classes: [...Cs]
): MergedActivities<Cs> {
  const result: Record<string, unknown> = {}
  const registered = new Map<string, Registration>()

  for (const Cls of classes) {
    const instance = new Cls()
    const bound = bindActivities(instance) as Record<string, unknown>

    for (const [name, fn] of Object.entries(bound)) {
      const defProto = findDefiningProto(instance, name)
      if (!defProto) continue

      const existing = registered.get(name)
      if (!existing) {
        result[name] = fn
        registered.set(name, { defProto, clsName: Cls.name })
        continue
      }

      const winner = resolveConflict(name, { defProto, clsName: Cls.name }, existing)
      if (winner) {
        result[name] = fn
        registered.set(name, winner)
      }
    }
  }

  return result as MergedActivities<Cs>
}
