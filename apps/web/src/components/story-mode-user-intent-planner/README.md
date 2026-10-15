# Story Mode User Intent Planner (UIP)

## Purpose

Productized UIP for Story Mode.
This module is UI-protocol-driven, backend-adapter-backed, and designed for future `SSE + HTTP`.

## Core Intent

- Backend response shape and frontend render shape are intentionally different.
- Frontend protocol is authoritative for rendering semantics.
- Adapter owns normalization and hard-coded product rules.
- Components must stay backend-agnostic and consume only `state + actions`.

## Directory Contract

- `planner/`: UI rendering only (block-based, no backend parsing).
- `state/`: planner state model (`atoms`, `computed`, `actions`, context/state types).
- `adapter/`: backend adapter implementation (session API + runtime sync + render protocol mapping).

## Layering and Responsibilities

- UI Layer (`planner/*`)
  - Reads atoms/computed and calls actions.
  - No direct backend/session/cdn/fetch logic.
  - Timeline renders `TimelineRenderBlock` only.

- State Layer (`state/*`)
  - `atoms`: base mutable state.
  - `computed`: pure derived selectors (`atom(get => ...)`).
  - `actions`: imperative flows; call `PlannerApi`; handle toast/error UX.

- Adapter Layer (`adapter/*`)
  - Owns backend API calls and DTO normalization.
  - Owns raw backend `Session` lifecycle.
  - Updates UI via `normalizeSessionToRenderState(...)`.
  - Provides injected `PlannerApi` for state actions.

## Single Source of Truth (SSOT)

- Raw backend session SSOT: `getAdapterSessionAtom` (adapter-private).
- Render SSOT: `getRenderStateAtom` (frontend protocol).
- Action boundary SSOT: `PlannerApi`.
- `StoryModeUserIntentPlanner` itself is state-input driven and can expose `ref.getState()`.

## Public Planner API (UI-facing only)

Defined in `state/planner-api.ts`:

- `confirmPlan()`
- `continueDraft()`
- `refresh()`
- `removeQueuedMessage(queueItemId)`
- `saveScriptDraft(script)`
- `sendMessage(message)`

Rule: this API must stay render-domain-oriented. Do not leak backend concepts.

## Adapter Runtime Pattern

- `initializePlannerState(...)` runs once per created session.
- It creates:
  - adapter `api` (`createApiAdapter`)
  - `applySession(nextSession)` (single sync path)
  - planner-facing `PlannerApi`
- It stores runtime in adapter atom and applies initial session once.
- `useInitSession(plannerState)` only polls and calls:
  - `runtime.api.getSession()`
  - `runtime.applySession(nextSession)`
- Polling must never re-run initialization.

## Integration Entry Points

- Creation flow lives outside UIP (currently Omni ChatBox submit branch):
  - build session input
  - `createSessionWithOmniInput(...)`
  - `initializePlannerState(...)`
  - open planner dialog
- UIP dialog branch only mounts planner and `useInitSession(plannerState)`.
- Initial message assets are created in session-create payload; timeline display is frontend protocol-driven and not expected to equal backend transcript structure.

## Render Protocol (Block-Based Timeline)

`state-types.ts` defines `TimelineRenderBlock` union, including:

- `message`
- `message_asset_list`
- `assistant_thinking`
- `video_brief_card`
- `script_transcript`
- `storyboards`
- `anchor_asset_list`

Key product rules in adapter reducer (`adapter/session-view-adapter/timeline.ts`):

- Transcript order is preserved.
- First user transcript may inject `message_asset_list` block when assets exist.
- Processing state appends `assistant_thinking` with `"Thinking..."`.
- `uploaded_assets` and `anchor_assets` are normalized separately, then merged into `assetsPool`.

## Message and Asset Semantics

- Message text is rendered from frontend block `text`.
- Inline tag parsing (`@img[...]`, `@video[...]`, etc.) happens at render time (`TimelineItem`), not in UI callsites.
- Tag preview resolution order:
  1. preview embedded in tag
  2. fallback by `resourceId` from `assetsPool`
- `assets_list` rendering is independent from whether inline tags exist.

## Atom Usage Rules

- Use `createWeakMapFn((scope) => atom...)` for planner-state-scoped atoms/computed.
- Keep cross-component shared state in atoms.
- Keep ephemeral local UI state local (focus, hover, transient open index, etc.).
- Avoid storing duplicated derivations in atoms when computed selectors are enough.

## UI/Interaction Principles

- Follow the product design as the contract (spacing, block order, states, motion).
- Distinguish clearly:
  - hover state
  - selected/active state
  - keyboard navigation state
- Quick question behavior:
  - global capture keyboard navigation
  - skip shortcuts during text editing
  - custom textarea has explicit submit behavior

## AGENTS/UIP Development Guidelines (Consolidated)

- Keep `atom / computed / action` separation.
- Backend and frontend state shapes must remain decoupled.
- Information parity is required; structural parity is not.
- Timeline protocol can diverge from backend transcript shape by design.
- Adapter layer is the only place for normalization and hard-coded product intent.
- Hard-coded protocol rules are valid when they encode stable product behavior.
- Frontend should be lock/guard robust and logic-lean.
- Build incrementally, keep modules small, and codify behavior in tests.
- UIP UI/state usage should stay backend-agnostic.
- Current backend adapter is replaceable by design.

## Testing Contract

- Adapter tests:
  - session -> render blocks mapping
  - asset pool normalization
  - first-transcript special rules
  - processing/thinking behavior
- State/action tests:
  - action -> PlannerApi invocation
  - success/failure draft behavior
- UI tests:
  - block rendering and order
  - quick option/composer branching

## Do / Don’t

- Do keep backend details inside adapter.
- Do evolve frontend protocol by adding block kinds, not backend-field branching in UI.
- Do keep naming short but semantic (`planner`, `state`, `api`, `runtime`).
- Don’t read/write backend session from planner UI components.
- Don’t couple UI behavior to raw backend payload structure.
- Don’t reinitialize planner state during polling.
