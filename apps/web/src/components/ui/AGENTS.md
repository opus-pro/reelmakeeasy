# AGENTS.md -- UI incubator (`apps/web/src/components/ui/`)

This is rung 1 of a two-rung ladder for UI primitives. `libs/shared/ui` is **not** a
destination at either rung -- it is frozen for new files.

## Before you build anything

Check `@/components/ui/kit` (promoted primitives). If it already has what you need,
import it -- do not re-implement.

## Rung 1 -- incubate here

- One kebab-case directory per component: `image-lightbox/ImageLightbox.tsx`,
  `index.ts`, co-located `ImageLightbox.test.tsx`.
- Flat list. No category subdirectories until ~15+ components force the issue.
- Each directory is one promotable unit: everything the component needs to move must
  live inside it.

### Purity rules

A component here is a **view**. It renders props.

- No app state: no Jotai atoms, no app context, no data fetching.
- No domain types. Each call site adapts its own model to the prop contract.
- Semantic tokens only -- no hex, no `text-white`, no `bg-[#...]`.
- Icons from `@/components/icons/core`, sized with Tailwind utilities.

Stateful wrappers and adapters live next to the feature that needs them, in
`apps/web/src/components/<feature>/`, not here.

## Rung 2 -- promote to `@/components/ui/kit`

**Pull-based, hard trigger only.** The day code outside `apps/web` concretely needs the component,
whoever hits that need does the promotion. No usage tracking, no metrics, no scheduled
sweep.

The trigger and the gates are separate things, and both must hold. The pull is what
_starts_ a promotion; the gates are what the component must **already** satisfy on that
day. A component that is pulled but not ready does not get promoted early -- it gets the
work done to meet the gates first, in the promoting PR.

- [ ] At least 3 call sites in this repo
- [ ] API stable ~4 weeks (no breaking prop change)
- [ ] Zero app-state imports
- [ ] Tokens only, light + dark verified
- [ ] Covered by tests in both modes, every variant, and text overflow
- [ ] The promotion, and what it replaces, is recorded in the pull request description

## Proving a component

An incubator component doesn't need any special review setup. Prove it with its
co-located unit tests plus a real before/after capture of the surface it ships on.
