import { SessionState } from '../types'

export function remapDirectiveShotIds(session: SessionState, mapping: Map<string, string>): void {
  for (const item of session.todo_state.items) {
    if (item.status !== 'pending') {
      continue
    }
    if (item.executor_hint?.scope_hint) {
      const mapped = mapping.get(item.executor_hint.scope_hint)
      if (mapped) {
        item.executor_hint.scope_hint = mapped
      }
    }
    const pattern = new RegExp(
      [...mapping.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join('|'),
      'g',
    )
    item.title = item.title.replace(pattern, (match) => mapping.get(match) ?? match)
    item.id = item.id.replace(pattern, (match) => mapping.get(match) ?? match)
  }
}
