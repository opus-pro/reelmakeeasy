/** Nx-style asset: copy a path, or glob from input into output under outputDir. */
export type BundleAsset =
  | string
  | {
      glob: string
      input: string
      output: string
    }

export interface BundleExecutorOptions {
  /**
   * Optional files/dirs to copy into outputDir after bundling (see schema.json).
   */
  assets?: BundleAsset[]
  /**
   * Additional ESBuild options to override defaults
   */
  esbuildOptions?: {
    bundle: boolean
    format: 'cjs' | 'esm' | 'iife'
    minify: boolean
    packages: 'bundle' | 'external'
    platform: 'browser' | 'neutral' | 'node'
    sourcemap: boolean
  }

  /**
   * Whether to generate minimal package.json using minimize-deps
   */
  generateMinimalDeps: boolean

  /**
   * Path to the TypeScript entry file (relative to project root), e.g. src/main.ts.
   * When runTsc is true, the executor uses the compiled .js under tscOutputDir.
   * When runTsc is false, this .ts file is passed to ESBuild directly.
   */
  mainFile: string

  /**
   * Output directory for the bundled file and meta.json
   */
  outputDir: string

  /**
   * Name of the output bundle file
   */
  outputFile: string

  /**
   * Additional runtime dependencies to always include in the minimal package.json
   */
  runtimeDeps: string[]

  /**
   * Whether to run TypeScript compiler first (required for projects using decorators)
   */
  runTsc: boolean

  /**
   * TSC command to run
   */
  tscCommand: string

  /**
   * Working directory for TSC command (relative to workspace root)
   */
  tscCwd?: string

  /**
   * Path to tsconfig.json file (relative to project root)
   */
  tsConfigPath?: string

  /**
   * Output directory for TSC compilation
   */
  tscOutputDir: string
}
