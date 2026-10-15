# AGENTS.md -- shared/ui (components + design tokens)

## FROZEN for new components

Do not add a new file under `src/`. The ESLint rule `reelmakeeasy/shared-ui-freeze-new-files`
fails on any file in that tree that was not present at freeze time. New UI primitives
incubate in `apps/web/src/components/ui/` instead -- see
[`apps/web/src/components/ui/AGENTS.md`](../../../apps/web/src/components/ui/AGENTS.md)
for the two-rung ladder.

Everything else in this lib stays live and is NOT deprecated: the UI parts in
`src/primitives/`, the design tokens in `src/tokens/`, and every existing
composite. The rest of this document still applies to all of them. When you move an
existing component out, delete its allowlist entry in `config/shared-ui-frozen-files.mjs`
in the same PR.

## Library boundary

1. **Boundary rule**: UI primitives (Button, Modal, Popover, Tooltip, ...) live in `src/primitives/` and the color/typography tokens in `src/tokens/`. They are our own code plus shadcn/ui-derived primitives (MIT; see NOTICE), built on open-source pieces (Radix, Embla, sonner, lucide-react). Do not import or copy code from internal, non-open-source UI libraries.
2. **What stays here** (app-specific): the `chat/*` composites, `VoiceList`, `OptionList`/`OptionRow`/`OptionDivider`, `CloseButton`, `Voice*Content`, plus the local keeper `Sheet` and the other `src/` composites.
3. **Enforcement**: `libs/shared/ui/components/ui/` must not be recreated (ESLint blocks it). New files elsewhere in `src/` are blocked by `reelmakeeasy/shared-ui-freeze-new-files`; `src/primitives/` and `src/tokens/` are exempt.

## Composition contract (views, wrappers, adapters)

Three layers, each with one rule. The question card (`chat/QuestionCard`) and `OptionList` are the reference instances.

1. **Pure views** (`chat/QuestionCard`, `OptionList`): render props, no app state (no Jotai, no context reads), no domain types, so every state is reachable through props alone.
2. **Stateful wrappers** own state and feed the view (app-side containers via Jotai or useState). A wrapper that reads app atoms lives in `apps/web`, never here.
3. **Adapters live in the consumer**: each surface maps its own domain model into the view's prop contract at the call site. This lib never imports a domain type to "help" -- that inverts the dependency and couples every consumer to every other's model. Do NOT merge per-surface derivations into a shared domain model here; that glue is the intended pattern.

Don't hand-roll the `useSelectableOptionList` + `OptionRow` + `OptionDivider` loop in new code; compose through `OptionList` and extend it (slot/prop) when it doesn't fit.

## Color and light/dark (non-negotiable)

- Use semantic tokens only -- never hardcoded hex, `text-white`, or arbitrary `[#...]`. If a color is wrong in light, the token mapping lives in `src/tokens/` -- fix it there, not in the component.
- Both modes come from the token CSS variables (`:root.ui` and `:root.ui.light`).

## Typography

- Use the type tokens from `src/tokens/` (the Tailwind font-size classes they define). Never inline font-size, line-height, or weight, and never `text-[..]`.
- Font family resolves through the CSS variables `--font-geist-sans` / `--font-geist-mono`; never hardcode a family-name string, and never the no-space `GeistSans` form.
- The host app owns the `@font-face` declaration (see `apps/web/src/app/styles/tailwind.css`). This lib ships no font file and no `@font-face`; it only emits the variable references above.
- The host app must define `--font-geist-sans` / `--font-geist-mono` under exactly those names. Any other name fails silently: components fall back to system sans at correct metrics, wrong typeface, no error thrown.

## Color CSS variables

- The Tailwind color and font-size maps (`createTailwindColors` / `createTailwindFontSize` in `src/tokens/`, wired in `tailwind.preset.ts`) read CSS variables by name. The variables themselves live in `apps/web/src/app/styles/ui-colors.css`; keep the names in sync when you change either side.

## Before a PR

- `npx nx lint shared/ui` and `npx nx test shared/ui` green.
- ASCII-only comments (ESLint `@nx/workspace-only-english-comments`).
