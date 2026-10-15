export function deleteNull<T extends object>(obj: T): T {
  for (const key in obj) {
    if ((obj as Record<string, unknown>)[key] === null) {
      delete (obj as Record<string, unknown>)[key]
    }
    if ((obj as Record<string, unknown>)[key] === undefined) {
      delete (obj as Record<string, unknown>)[key]
    }
  }
  return obj
}
