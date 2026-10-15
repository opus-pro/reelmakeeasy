import { AbstractService } from './abstract'

type AnyWorkflowCtor = WorkflowCtor<AbstractService>

type InstanceOfWorkflowCtor<C extends AnyWorkflowCtor> =
  C extends WorkflowCtor<infer T extends AbstractService> ? T : never

type MergedWorkflows<Cs extends AnyWorkflowCtor[]> = Cs extends [
  infer C extends AnyWorkflowCtor,
  ...infer Rest extends AnyWorkflowCtor[],
]
  ? MergedWorkflows<Rest> & WorkflowMethods<InstanceOfWorkflowCtor<C>>
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {}

interface WorkflowCtor<T extends AbstractService> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): T
  bindWorkflow(method: string): unknown
  name: string
  prototype: T
}

type WorkflowKeys<T extends AbstractService> =
  Exclude<keyof T, keyof AbstractService> extends infer K
    ? K extends string
      ? K extends Capitalize<K & string>
        ? T[K extends keyof T ? K : never] extends (...args: never[]) => unknown
          ? K
          : never
        : never
      : never
    : never

type WorkflowMethods<T extends AbstractService> = {
  [K in WorkflowKeys<T>]: T[K]
}

/**
 * Binds all PascalCase prototype methods (workflow entry points) via `cls.bindWorkflow`.
 * Walks the prototype chain up to (not including) AbstractService.prototype.
 */
export function bindWorkflows<T extends AbstractService>(cls: WorkflowCtor<T>): WorkflowMethods<T> {
  const result: Record<string, unknown> = {}
  let proto: null | object = cls.prototype

  while (proto && proto !== AbstractService.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue
      if (!/^[A-Z]/.test(key)) continue // camelCase -> activity, skip
      if (key in result) continue // keep most-derived override
      const val = (proto as Record<string, unknown>)[key]
      if (typeof val === 'function') {
        result[key] = cls.bindWorkflow(key)
      }
    }
    proto = Object.getPrototypeOf(proto)
  }

  return result as WorkflowMethods<T>
}

/**
 * Merges workflows from multiple service classes into a single registry object,
 * ready to use as a workflows module's named exports.
 *
 * - Only includes PascalCase methods (workflow entry points by convention).
 * - Excludes methods inherited from AbstractService itself.
 * - Throws on duplicate workflow names from different source classes.
 */
export function exportWorkflows<Cs extends AnyWorkflowCtor[]>(
  ...classes: [...Cs]
): MergedWorkflows<Cs> {
  const result: Record<string, unknown> = {}
  const sourceMap = new WeakMap<WeakKey, AnyWorkflowCtor>()

  for (const cls of classes) {
    const bound = bindWorkflows(cls) as Record<string, unknown>
    for (const [name, fn] of Object.entries(bound)) {
      if (!(name in result)) {
        result[name] = fn
        if (typeof fn === 'function') {
          sourceMap.set(fn as WeakKey, cls)
        }
        continue
      }
      const existingSource = sourceMap.get(result[name] as WeakKey)
      if (existingSource !== cls) {
        throw new Error(
          `Duplicate workflow "${name}" from ${existingSource?.name ?? 'unknown'} and ${cls.name}`,
        )
      }
    }
  }

  return result as MergedWorkflows<Cs>
}
