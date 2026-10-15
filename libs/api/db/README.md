# api/db

Shared Prisma entrypoint for the API's database, imported as `@reelmakeeasy/api-db`.

## What lives here

- `prisma/schema.prisma` is the canonical API schema.
- `src/index.ts` is the typed source entry used in the repo.
- `index.js` and `index.d.ts` make the package consumable as a runtime dependency.

## Common commands

- `pnpm exec nx run api/db:generate`
