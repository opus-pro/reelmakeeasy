# VideoPlayer — keep it feature-agnostic

`VideoPlayer`, `VideoOverlayControls`, and their hooks (`useVideoPlayer`,
`useOverlaySeekBar`) are a **generic, reusable video player**, consumed across
unrelated surfaces — story-mode, templates, avatar, scene canvas,
home. Keep them decoupled from any single feature.

## MUST NOT

- Import from feature areas: `story-mode`, `story-mode-canvas`,
  `story-mode-user-intent-planner` (UIP / planner), `editor`, or
  any feature store / hook / model type. No `@/app/story-mode/…`,
  no feature-specific context.
- Encode feature-specific behavior (director / agent state, project or scene
  models). This component knows about _video_, not the product.

## MUST

- Communicate only via props and callbacks. If a consumer needs feature behavior
  (analytics, custom overlays, keyboard scoping), lift it into the consumer and
  pass it down — never reach up from the player.
- Dependencies are fine as long as they are **generic, not feature-specific**:
  - React, `@/components/icons/core`, `@/components/ui/kit` (raw design primitives).
  - `@shared/ui` — the app's wrappers over those primitives (`cn`, `Button`,
    `Slider`, …). Expected and allowed; that layer is what it's there for.
    (`@shared/ui` is itself slated for eventual deprecation; when that happens
    these imports move elsewhere naturally — no action needed here today.)
  - Generic app utils / hooks (`@/util/*`, `@/hooks/*`).

  The invariant is the MUST NOT above — no _feature_ imports — not a closed
  allowlist of packages. Keep app-infra coupling out where it's cheap to: the
  player deliberately has no logger dependency (a rare, unmonitored seek-race
  error is swallowed in `useVideoPlayer`), so don't reintroduce one.

## Where this lives, and why

This player stays in `apps/web/src/components/`. It is deliberately **not** being
moved into `libs/shared/ui`.

- **Importing from `@shared/ui` here is expected** — it's the app's wrapper layer over
  the `@/components/ui/kit` design primitives, and consuming it is exactly its purpose.
  Those imports stay valid until that layer itself is retired, at which point they
  move elsewhere naturally.
- What is changing is **placement, not consumption**: `libs/shared/ui` is being
  wound down as a _home_ for shared components. Don't add new shared components
  there; its contents migrate out over time.
- The default home for a component is the app. A component moves out **only
  once it is a proven fact it is shared** — and never to `libs/shared/ui`.
- The feature-agnostic discipline above is what keeps that path open. The moment
  a feature import creeps in, it stops being shareable and the option is gone.

Respect this convention on every change to this directory.
