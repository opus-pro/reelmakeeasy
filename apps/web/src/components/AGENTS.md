# AGENTS.md -- `apps/web/src/components/`

App compounds live here: components that know about this app's state, domain types, and
data fetching. Jotai atoms, app context, and feature-specific types are all fine at this
level.

Reusable, state-free UI primitives do **not** live here -- they go in
[`ui/`](./ui/AGENTS.md), the incubator. The split is the same one that makes a component
promotable later: `ui/` renders props, everything else here binds those views to the app.

`libs/shared/ui` is frozen for new files; it is not an option for either kind.
