# Contributing to ReelMakeEasy

Thanks for helping out. This guide covers what a good change looks like here.

## Getting set up

Follow the [quick start](README.md#quick-start). You need Node.js 22+, pnpm and FFmpeg. Provider keys are only needed to exercise generation end to end.

While you change the code, run `pnpm dev` instead of `pnpm reelmakeeasy start`: the web app compiles each page as you visit it and picks up your edits. The API does not reload on its own, so restart `pnpm dev` after changing API code. `pnpm reelmakeeasy start` runs the production build, which is faster to use but rebuilds (a few minutes) after every change.

## Before you open a pull request

```bash
pnpm exec nx run-many -t type-check
pnpm exec tsc -p apps/web/tsconfig.json --noEmit
pnpm exec nx run-many -t test -p workflow-engine llm common
node --test scripts/reelmakeeasy-onboarding.test.mjs scripts/reelmakeeasy-setup-ui.test.mjs scripts/reelmakeeasy-build.test.mjs scripts/reelmakeeasy-docs.test.mjs scripts/repo-hygiene.test.mjs
```

- **Keep changes small and focused.** One behavior change per pull request. Split refactors from feature work.
- **Match the surrounding code.** Same naming, comment density and idioms. Prettier and ESLint settings are in the repo root.
- **Add or update tests** for behavior you change, next to the code (`*.test.ts`).
- **No secrets, hosts or model ids in source.** New configuration goes through an environment variable, documented in `.env.example`.
- **No new provider SDKs.** Providers are called over plain HTTP (`libs/llm`, `libs/shared/common/src/elevenlabs`). Keep it that way so the dependency tree stays small.
- **Workflows run in-process.** Code under `libs/story-mode-runtime/src/workflows` must keep per-run state in local variables or `getRunLocal`/`setRunLocal`, never in module-level variables: concurrent runs share modules.

## Commit messages and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `chore: …`. The title says what changed; the description says why, and how you tested it.

## License

ReelMakeEasy is licensed under the [GNU AGPL-3.0](LICENSE). Before we can merge your first pull request you'll be asked to sign the [Contributor License Agreement](CLA.md). It lets Opus keep offering the project under both AGPL-3.0 and a commercial license; you keep all rights to your own work.
