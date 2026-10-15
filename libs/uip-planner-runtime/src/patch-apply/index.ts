// Folder barrel so the `@reelmakeeasy/uip-planner-runtime/patch-apply` subpath (mapped
// by tsconfig `@reelmakeeasy/uip-planner-runtime/*` -> `src/*`) keeps resolving after
// patch-apply.ts moved into this folder. Re-exports the module's public surface
// exactly as the old `src/patch-apply.ts` file did (e.g. applyPatch,
// normalizeBrandUrl) so external consumers are unchanged.
export * from './patch-apply'
