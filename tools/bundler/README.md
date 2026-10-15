# build-bundle

Consolidated build tool that combines TypeScript compilation (TSC), ESBuild bundling, and minimal dependency generation into a single executor.

## Features

- **Optional TSC Step**: Toggle TypeScript compilation for projects using decorators (e.g. NestJS)
- **ESBuild Bundling**: Fast bundling with customizable options
- **Minimal Dependencies**: Generates a minimal `package.json` with only required runtime deps
- **Single entry**: `mainFile` is always your TypeScript entry; the executor picks the compiled `.js` when TSC runs, or passes the `.ts` file to ESBuild when it doesn’t

## Configuration

### Required

- **`mainFile`** (string): Path to the **TypeScript** entry file (relative to project root), e.g. `src/main.ts`. When `runTsc` is true, the executor uses the compiled `.js` under `tscOutputDir`. When `runTsc` is false, this `.ts` file is passed to ESBuild directly. Supports `{projectRoot}` and `{workspaceRoot}`.

### Optional

| Option                | Type     | Default           | Description                                                                          |
| --------------------- | -------- | ----------------- | ------------------------------------------------------------------------------------ |
| `runTsc`              | boolean  | `true`            | Run TypeScript compiler before ESBuild (needed for decorators).                      |
| `tscCommand`          | string   | `"tsc --build"`   | Command to run for TSC.                                                              |
| `tscCwd`              | string   | `"{projectRoot}"` | Working directory for TSC (relative to workspace root).                              |
| `tscOutputDir`        | string   | `"out-tsc"`       | Output directory for TSC (relative to project root).                                 |
| `tsConfigPath`        | string   | —                 | Path to `tsconfig.json` (relative to project root).                                  |
| `outputDir`           | string   | `"dist"`          | Output directory for the bundle and `meta.json`.                                     |
| `outputFile`          | string   | `"main.js"`       | Name of the output bundle file.                                                      |
| `generateMinimalDeps` | boolean  | `true`            | Generate minimal `package.json` from metafile.                                       |
| `runtimeDeps`         | string[] | `[]`              | Extra runtime deps to always include (only used when `generateMinimalDeps` is true). |
| `esbuildOptions`      | object   | —                 | Override ESBuild defaults (see below).                                               |

**`esbuildOptions`** (all optional): `bundle` (true), `platform` ("node"), `packages` ("external"), `format` ("cjs"), `sourcemap` (false), `minify` (false).

---

## Best practice: NestJS (TSC enabled)

Use TSC first so decorators and metadata are compiled correctly, then bundle the compiled JS.

```json
{
  "targets": {
    "build": {
      "executor": "@tools/bundler:bundle",
      "cache": true,
      "outputs": ["{projectRoot}/dist"],
      "options": {
        "mainFile": "src/main.ts",
        "tscCwd": "{projectRoot}",
        "generateMinimalDeps": true,
        "runtimeDeps": [
          "@nestjs/core",
          "@nestjs/platform-express",
          "@prisma/client",
          "dotenv-flow",
          "class-transformer",
          "class-validator"
        ]
      },
      "configurations": {
        "development": {
          "generateMinimalDeps": false,
          "esbuildOptions": { "sourcemap": true }
        },
        "production": {}
      }
    }
  }
}
```

- **`mainFile`**: Your TS entry; the executor uses `out-tsc/src/main.js` for ESBuild when `runTsc` is true.
- **`tscCwd`**: `"{projectRoot}"` so TSC runs from the app directory (match your `tsconfig.json` and `outDir`).
- **`runtimeDeps`**: List Nest and other runtime deps so the minimal `package.json` is complete.
- **Development**: Often disable `generateMinimalDeps` and enable `sourcemap` for faster iteration.

---

## Best practice: No TSC (direct ESBuild)

For apps without decorators, skip TSC and point ESBuild at the `.ts` file directly.

```json
{
  "targets": {
    "build": {
      "executor": "@tools/bundler:bundle",
      "cache": true,
      "outputs": ["{projectRoot}/dist"],
      "options": {
        "runTsc": false,
        "mainFile": "src/main.ts",
        "runtimeDeps": ["express"]
      }
    }
  }
}
```

- **`runTsc`**: `false` so the executor does not run TSC.
- **`mainFile`**: Same TS entry; the executor passes it to ESBuild as-is (ESBuild compiles TypeScript).

---

## Using with @nx/js:node (serve)

To run the built app with `nx serve my-app` (`@nx/js:node`), point `buildTarget` at your build-bundle target and keep the default output so serve can find the bundle:

- **`buildTarget`**: e.g. `"my-app:build"` (or `my-app:build:development` / `my-app:build:production` in configurations).
- **`outputs`**: Keep `["{projectRoot}/dist"]` so serve can resolve the output directory.
- **Output file**: Keep default `outputFile: "main.js"` so serve looks for `dist/main.js`.
- **`runBuildTargetDependencies`**: Set to `true` so the build runs via `nx run my-app:build`; recommended when using a custom executor so serve reliably runs the build and then the bundle.

Example `serve` target:

```json
"serve": {
  "executor": "@nx/js:node",
  "options": {
    "buildTarget": "my-app:build",
    "runBuildTargetDependencies": true
  },
  "configurations": {
    "development": { "buildTarget": "my-app:build:development" },
    "production": { "buildTarget": "my-app:build:production" }
  }
}
```

---

## Custom ESBuild options

Override defaults via `esbuildOptions`:

```json
{
  "options": {
    "mainFile": "src/main.ts",
    "esbuildOptions": {
      "platform": "browser",
      "format": "esm",
      "minify": true,
      "sourcemap": true
    }
  }
}
```
