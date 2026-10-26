import { builtinModules } from 'node:module'

import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import nextPlugin from '@next/eslint-plugin-next'
import nx from '@nx/eslint-plugin'
import { defineConfig } from 'eslint/config'
import prettierConfig from 'eslint-config-prettier'
import eslintPluginJest from 'eslint-plugin-jest'
import nodeDependencies from 'eslint-plugin-node-dependencies'
import perfectionist from 'eslint-plugin-perfectionist'
import prettier from 'eslint-plugin-prettier'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginSimpleImportSort from 'eslint-plugin-simple-import-sort'
import sonarjs from 'eslint-plugin-sonarjs'
import eslintPluginTailwindCSS from 'eslint-plugin-tailwindcss'
import unicorn from 'eslint-plugin-unicorn'
import jsxA11y from 'jsx-a11y-unstable'

import { loggerDroppedArgsLegacyConfig } from './config/logger-dropped-args-legacy-files.mjs'
import { sharedUiFrozenFiles } from './config/shared-ui-frozen-files.mjs'

// Base configurations from Nx
const nxConfigs = [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...nx.configs['flat/react-typescript'],
]

// Global ignores
const ignoresConfig = {
  ignores: [
    '**/.next/',
    '**/.next-prod/',
    '**/.nx/',
    '**/.venv/',
    '**/AVEditorEngine.*',
    '**/_next/',
    '**/cache/',
    '**/coverage',
    '**/dist/',
    '**/generated/**',
    '**/htmlcov/',
    '**/next-env.d.ts',
    '**/node_modules/',
    '**/out-tsc/',
    '**/out/',
    // A Motion Reel's Remotion template: its own project, typed against the runtime it links to.
    'presets/motion-reel/template/',
    // The Motion Reel composer, vendored as it was written (tools/motion-composer/README.md).
    'tools/motion-composer/',
    '**/public/',
    '**/tmp/',
    '**/venv/',
  ],
  name: 'reelmakeeasy/ignores',
}

// Import sorting configuration
const importSortRules = {
  'simple-import-sort/exports': 'error',
  'simple-import-sort/imports': [
    'error',
    {
      groups: [
        // Side effect imports
        [String.raw`^\u0000`],
        // Node.js built-in modules
        ['^node:'],
        // External packages
        [String.raw`^@?\w`],
        // Internal packages (monorepo packages)
        ['^(@|~)/'],
        // Parent imports (../)
        [String.raw`^\.\.(?!/?$)`, String.raw`^\.\./?$`],
        // Other relative imports (same folder)
        [String.raw`^\./(?=.*/)(?!/?$)`, String.raw`^\.(?!/?$)`, String.raw`^\./?$`],
        // Style imports
        [String.raw`^.+\.s?css$`],
      ],
    },
  ],
}

// Nx module boundaries configuration
const nxModuleBoundariesRules = {
  '@nx/enforce-module-boundaries': [
    'error',
    {
      allow: [
        String.raw`^.*/eslint(\.base)?\.config\.[cm]?[jt]s$`,
        String.raw`^.*/jest\.base\.mjs$`,
      ],
      depConstraints: [
        {
          sourceTag: '*',
          onlyDependOnLibsWithTags: ['*'],
        },
        // Shared workspace types package: no internal lib dependencies
        {
          sourceTag: 'type:types',
          onlyDependOnLibsWithTags: [],
        },
        // @reelmakeeasy/common: may only depend on shared types (among workspace libs)
        {
          sourceTag: 'type:util',
          onlyDependOnLibsWithTags: ['type:types'],
        },
        // api scope: only shared + api libs
        {
          sourceTag: 'scope:api',
          onlyDependOnLibsWithTags: ['scope:shared', 'scope:api'],
        },
        {
          sourceTag: 'scope:agent',
          notDependOnLibsWithTags: ['scope:story-mode'],
        },
      ],
      enforceBuildableLibDependency: true,
      // jest.mock('@reelmakeeasy/api-db', ...) is modeled as a dynamic dependency; without this,
      // @nx/enforce-module-boundaries forbids any static import of api/db in the same project.
      checkDynamicDependenciesExceptions: ['@reelmakeeasy/api-db'],
    },
  ],
}

// Code style rules
const codeStyleRules = {
  quotes: ['error', 'single', { avoidEscape: true }],
  '@typescript-eslint/no-unsafe-function-type': 'off',
  'padding-line-between-statements': [
    'error',
    { blankLine: 'always', next: '*', prev: 'import' },
    { blankLine: 'any', next: 'import', prev: 'import' },
  ],
  'prettier/prettier': 'error',
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      args: 'none',
      ignoreRestSiblings: true,
    },
  ],
  'no-console': 'error',
}

// // TypeScript-specific rules that require type information
// const typeScriptRules = {
//   '@typescript-eslint/no-base-to-string': 'error',
// }

// Dynamic import restrictions
const importRestrictionRules = {
  'no-restricted-syntax': [
    'error',
    {
      message: 'Dynamic imports (lazy imports) are not allowed. Use static imports instead.',
      selector: 'ImportExpression',
    },
    {
      message: 'Awaited dynamic imports are not allowed. Use static imports instead.',
      selector: 'AwaitExpression > ImportExpression',
    },
    {
      message:
        'Inline require() calls are not allowed. Use import statements at the top of the file instead.',
      selector: 'CallExpression[callee.name="require"]',
    },
    {
      message:
        'require.main === module is not allowed outside scripts/ directories. Imports must be side-effect-free; use an explicit esbuild entry point instead.',
      selector:
        'IfStatement > BinaryExpression[operator="==="][left.object.name="require"][left.property.name="main"]',
    },
  ],
}

const baseNoRestrictedImportsRule = [
  'error',
  {
    paths: [
      {
        name: '@nestjs/common',
        importNames: ['Logger'],
        message: 'Please use Logger from @reelmakeeasy/common/logger instead.',
      },
      {
        name: 'lodash',
        message: 'Please use lodash-es instead of lodash for better tree-shaking support.',
      },
    ],
  },
]

const baseNoRestrictedImportsOptions = /** @type {Record<string, any>} */ (
  baseNoRestrictedImportsRule?.[1] ?? {}
)

const existingPromptPatterns = Array.isArray(baseNoRestrictedImportsOptions.patterns)
  ? [...baseNoRestrictedImportsOptions.patterns]
  : []

const promptNoRestrictedImportsRule = [
  baseNoRestrictedImportsRule?.[0] ?? 'error',
  {
    ...baseNoRestrictedImportsOptions,
    paths: Array.isArray(baseNoRestrictedImportsOptions.paths)
      ? [...baseNoRestrictedImportsOptions.paths]
      : baseNoRestrictedImportsOptions.paths,
    patterns: [
      ...existingPromptPatterns,
      {
        group: [
          '**/apps/**',
          '**/libs/agent/**',
          '**/services/**',
          '**/service/**',
          '**/repositories/**',
          '**/repository/**',
          '**/data-access/**',
          '**/database/**',
          '**/datasource/**',
          '**/db/**',
          '@agent-lib/*',
          '@reelmakeeasy/common/*',
          '@shared/common/*',
        ],
        message:
          'Prompts must be pure functions. Pass data as arguments instead of importing business logic.',
      },
    ],
  },
]

const generalNoRestrictedImportsConfig = {
  files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
  ignores: ['**/*.prompt.ts'],
  name: 'reelmakeeasy/no-restricted-imports',
  rules: {
    'no-restricted-imports': baseNoRestrictedImportsRule,
  },
}

const storyModeRuntimeImportBoundaryConfig = {
  files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
  ignores: ['apps/services/story-mode/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
  name: 'reelmakeeasy/story-mode-runtime-import-boundary',
  rules: {
    'no-restricted-imports': [
      'error',
      {
        ...baseNoRestrictedImportsOptions,
        paths: Array.isArray(baseNoRestrictedImportsOptions.paths)
          ? [...baseNoRestrictedImportsOptions.paths]
          : baseNoRestrictedImportsOptions.paths,
        patterns: [
          ...(Array.isArray(baseNoRestrictedImportsOptions.patterns)
            ? baseNoRestrictedImportsOptions.patterns
            : []),
          {
            group: ['@reelmakeeasy/story-mode-runtime', '@reelmakeeasy/story-mode-runtime/*'],
            message:
              'Only apps/services/story-mode may import @reelmakeeasy/story-mode-runtime directly.',
          },
        ],
      },
    ],
  },
}

const promptPurityConfig = {
  files: ['**/*.prompt.ts'],
  name: 'reelmakeeasy/prompt-purity',
  rules: {
    'no-restricted-imports': promptNoRestrictedImportsRule,
    'no-restricted-properties': [
      'error',
      {
        object: 'process',
        property: 'env',
        message:
          'Prompts must be pure functions. Pass data as arguments instead of importing business logic.',
      },
    ],
    'no-restricted-globals': [
      'error',
      {
        name: 'process',
        message:
          'Prompts must be pure functions. Pass data as arguments instead of importing business logic.',
      },
    ],
  },
}

// ESLint Comments rules
const eslintCommentsRules = {
  ...eslintComments.configs.recommended.rules,
  '@eslint-community/eslint-comments/no-unused-disable': 'error',
  '@eslint-community/eslint-comments/no-use': [
    'error',
    { allow: ['eslint-disable-next-line', 'eslint-disable-line'] },
  ],
  'prefer-const': ['error', { destructuring: 'all' }],
}

// Perfectionist rules
const perfectionistRules = {
  'perfectionist/sort-exports': 'off',
  'perfectionist/sort-imports': 'off',
  'perfectionist/sort-named-imports': 'off',
  'perfectionist/sort-objects': 'off',
  'perfectionist/sort-modules': ['error', { partitionByComment: true }],
}

// SonarJS rules
const sonarjsRules = {
  'sonarjs/anchor-precedence': 'off',
  'sonarjs/code-eval': 'off',
  // Prevent too complex code. Spec see https://sonarsource.github.io/rspec/#/rspec/S3776/javascript
  // Why 20? Because default value is 15, I think +5 is a good balance.
  'sonarjs/cognitive-complexity': ['error', 20],
  'sonarjs/comma-or-logical-or-case': 'off',
  'sonarjs/concise-regex': 'off',
  'sonarjs/constructor-for-side-effects': 'off',
  'sonarjs/content-length': 'off',
  'sonarjs/cors': 'off',
  'sonarjs/deprecation': 'off',
  'sonarjs/different-types-comparison': 'off',
  'sonarjs/duplicates-in-character-class': 'off',
  'sonarjs/fixme-tag': 'off',
  'sonarjs/function-return-type': 'off',
  'sonarjs/hashing': 'off',
  'sonarjs/link-with-target-blank': 'off',
  'sonarjs/no-clear-text-protocols': 'off',
  'sonarjs/no-commented-code': 'off',
  'sonarjs/no-control-regex': 'off',
  'sonarjs/no-dead-store': 'off',
  'sonarjs/no-duplicate-in-composite': 'off',
  'sonarjs/no-duplicate-string': 'off',
  'sonarjs/no-empty-alternatives': 'off',
  'sonarjs/no-empty-test-file': 'off',
  'sonarjs/no-exclusive-tests': 'off',
  'sonarjs/no-hardcoded-ip': 'off',
  'sonarjs/no-hardcoded-secrets': 'off',
  'sonarjs/no-ignored-exceptions': 'off',
  'sonarjs/no-invariant-returns': 'off',
  'sonarjs/no-nested-assignment': 'off',
  'sonarjs/no-nested-conditional': 'off',
  'sonarjs/no-nested-functions': 'off',
  'sonarjs/no-os-command-from-path': 'off',
  'sonarjs/no-primitive-wrappers': 'off',
  'sonarjs/no-redundant-assignments': 'off',
  'sonarjs/no-unenclosed-multiline-block': 'off',
  'sonarjs/no-unused-vars': 'off',
  'sonarjs/no-useless-react-setstate': 'off',
  'sonarjs/os-command': 'off',
  'sonarjs/prefer-promise-shorthand': 'off',
  'sonarjs/prefer-read-only-props': 'off',
  'sonarjs/prefer-regexp-exec': 'off',
  'sonarjs/prefer-single-boolean-return': 'off',
  'sonarjs/pseudo-random': 'off',
  'sonarjs/public-static-readonly': 'off',
  'sonarjs/publicly-writable-directories': 'off',
  'sonarjs/redundant-type-aliases': 'off',
  'sonarjs/regex-complexity': 'off',
  'sonarjs/single-character-alternation': 'off',
  'sonarjs/slow-regex': 'off',
  'sonarjs/table-header': 'off',
  'sonarjs/todo-tag': 'off',
  'sonarjs/updated-loop-counter': 'off',
  'sonarjs/use-type-alias': 'off',
  'sonarjs/void-use': 'off',
  'sonarjs/x-powered-by': 'off',
}

// Unicorn rules https://github.com/sindresorhus/eslint-plugin-unicorn
const unicornRules = {
  'unicorn/catch-error-name': 'off',
  'unicorn/consistent-function-scoping': 'off',
  'unicorn/error-message': 'off',
  'unicorn/explicit-length-check': 'off',
  'unicorn/filename-case': 'off',
  'unicorn/import-style': 'off',
  'unicorn/no-anonymous-default-export': 'off',
  'unicorn/no-array-callback-reference': 'off',
  'unicorn/no-array-for-each': 'off',
  'unicorn/no-array-reduce': 'off',
  'unicorn/no-array-sort': 'off',
  'unicorn/no-await-expression-member': 'off',
  'unicorn/no-for-loop': 'off',
  'unicorn/no-instanceof-array': 'off',
  'unicorn/no-length-as-slice-end': 'off',
  'unicorn/no-nested-ternary': 'off',
  'unicorn/no-new-array': 'off',
  'unicorn/no-null': 'off',
  'unicorn/no-process-exit': 'off',
  'unicorn/no-static-only-class': 'off',
  'unicorn/no-unreadable-array-destructuring': 'off',
  'unicorn/no-useless-undefined': 'off',
  'unicorn/number-literal-case': ['error', { hexadecimalValue: 'lowercase' }],
  'unicorn/numeric-separators-style': 'off',
  'unicorn/prefer-add-event-listener': 'off',
  'unicorn/prefer-at': 'off',
  'unicorn/prefer-blob-reading-methods': 'off',
  'unicorn/prefer-code-point': 'off',
  'unicorn/prefer-default-parameters': 'off',
  'unicorn/prefer-dom-node-append': 'off',
  'unicorn/prefer-dom-node-dataset': 'off',
  'unicorn/prefer-dom-node-remove': 'off',
  'unicorn/prefer-dom-node-text-content': 'off',
  'unicorn/prefer-event-target': 'off',
  'unicorn/prefer-export-from': 'off',
  'unicorn/prefer-global-this': 'off',
  'unicorn/prefer-logical-operator-over-ternary': 'off',
  'unicorn/prefer-module': 'off',
  'unicorn/prefer-native-coercion-functions': 'off',
  'unicorn/prefer-optional-catch-binding': 'off',
  'unicorn/prefer-query-selector': 'off',
  'unicorn/prefer-regexp-test': 'off',
  'unicorn/prefer-set-has': 'off',
  'unicorn/prefer-spread': 'off',
  'unicorn/prefer-string-replace-all': 'off',
  'unicorn/prefer-structured-clone': 'off',
  'unicorn/prefer-switch': 'off',
  'unicorn/prefer-ternary': 'off',
  'unicorn/prefer-top-level-await': 'off',
  'unicorn/prefer-type-error': 'off',
  'unicorn/prevent-abbreviations': 'off',
}

// Node dependencies rules
// Package.json specific configuration for node-dependencies rules
const nodeDependenciesConfig = {
  files: ['**/package.json'],
  name: 'reelmakeeasy/package-json',
  rules: {
    'node-dependencies/absolute-version': ['error', 'always'],
  },
}

// Enforce that only root package.json may declare dependencies / devDependencies
const noSubPackageDependenciesConfig = {
  files: ['apps/**/package.json', 'libs/**/package.json'],
  name: 'reelmakeeasy/no-sub-package-dependencies',
  rules: {
    '@nx/workspace-no-sub-package-dependencies': 'error',
  },
}

const testFilesConfig = {
  files: ['**/*.test.{ts,tsx,js,jsx}'],
  name: 'reelmakeeasy/tests',
  plugins: {
    jest: eslintPluginJest,
  },
  rules: {
    ...eslintPluginJest.configs['flat/recommended'].rules,
    'jest/no-focused-tests': 'error',
    '@nx/workspace-no-mock-global-logger': 'error',
  },
}

const nxWorkSpaceAndCustomRules = {
  // nx rules
  '@nx/workspace-logger-import-restriction': 'error',
  '@nx/workspace-logger-naming': 'error',
  // pino drops message-first args no placeholder consumes; the runtime hook rescues the
  // legacy sites, so this only warns against new drift
  '@nx/workspace-logger-no-dropped-args': 'warn',
  '@nx/workspace-no-export-internal': 'error',
  // rule to disable non-ASCII comments
  '@nx/workspace-only-english-comments': 'error',
  // == rules for enums ==
  // only enum declarations in *.enum.ts; tools/eslint-rules/rules/only-enum-in-enum-ts.ts
  '@nx/workspace-only-enum-in-enum-ts': 'error',
  // prohibit Zod .nullable() to prevent OpenAI Structured Outputs API errors; tools/eslint-rules/rules/no-zod-optional.ts
  '@nx/workspace-no-zod-optional': 'error',
  // prohibit z.unknown() in OpenAI response schemas; tools/eslint-rules/rules/no-zod-unknown.ts
  '@nx/workspace-no-zod-unknown': 'error',
  // prohibit direct pii field access from request context; tools/eslint-rules/rules/no-pii-field-access.ts
  '@nx/workspace-no-pii-field-access': 'error',
}

const cssRules = {
  'tailwindcss/migration-from-tailwind-2': 'off',
  'tailwindcss/no-custom-classname': 'off',
  'tailwindcss/classnames-order': 'off',
}

// Main project configuration for JavaScript files
const projectConfig = {
  files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
  name: 'reelmakeeasy/project',
  plugins: {
    '@eslint-community/eslint-comments': eslintComments,
    'jsx-a11y': jsxA11y,
    prettier,
    'react-hooks': eslintPluginReactHooks,
    'simple-import-sort': eslintPluginSimpleImportSort,
  },
  rules: {
    ...nxModuleBoundariesRules,
    ...importSortRules,
    ...codeStyleRules,
    ...importRestrictionRules,
    ...eslintCommentsRules,
    ...perfectionistRules,
    ...sonarjsRules,
    ...unicornRules,
    ...nxWorkSpaceAndCustomRules,
    ...cssRules,
  },
}

// Configuration files and scripts that are allowed to use require()
const configFilesConfig = {
  files: [
    '**/*.config.js',
    '**/*.config.cjs',
    '**/jest.config.mjs',
    '**/webpack.config.js',
    '**/next.config.js',
    '**/tailwind.config.js',
    '**/postcss.config.js',
    '**/eslint.config.js',
    '**/prettier.config.js',
    '**/babel.config.js',
    '**/rollup.config.js',
    '**/vite.config.js',
    '**/vitest.config.js',
    // CLI utility scripts
    // Build and setup scripts
    '**/scripts/**/*.js',
    '**/scripts/**/*.mjs',
    '**/scripts/**/*.mts',
    '**/scripts/**/*.ts',
    // Test files
    '**/*.test.ts',
    // Tool scripts
    'tools/**/*.js',
    'tools/**/*.ts',
    // Basic, pure config files
    'libs/shared/common/src/utils/env.util.ts',
  ],
  name: 'reelmakeeasy/config-files',
  rules: {
    'no-restricted-syntax': 'off', // Allow require() in config files and utility scripts
    'no-console': 'off', // Allow console.log in scripts and config files
  },
}

// Block recreation of the retired local primitives directory; primitives live in
// libs/shared/ui/src/primitives
const sharedUiNoLocalPrimitivesConfig = {
  name: 'reelmakeeasy/shared-ui-no-local-primitives',
  files: ['libs/shared/ui/components/ui/**/*'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Program',
        message:
          'libs/shared/ui/components/ui is retired: primitives live in libs/shared/ui/src/primitives.',
      },
    ],
  },
}

// Freeze libs/shared/ui/src for NEW components: only the files present at freeze time
// (config/shared-ui-frozen-files.mjs) may exist. New UI components incubate in
// apps/web/src/components/ui/ instead; see apps/web/src/components/ui/AGENTS.md.
// The UI parts and design tokens under
// primitives/ and tokens/ are exempt: they are the shared UI building blocks.
const sharedUiFreezeNewFilesConfig = {
  name: 'reelmakeeasy/shared-ui-freeze-new-files',
  files: ['libs/shared/ui/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
  ignores: [
    ...sharedUiFrozenFiles,
    'libs/shared/ui/src/primitives/**',
    'libs/shared/ui/src/tokens/**',
  ],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Program',
        message:
          'libs/shared/ui is frozen for new files: incubate new UI components in apps/web/src/components/ui/ (see apps/web/src/components/ui/AGENTS.md).',
      },
    ],
  },
}

// Disallow *.spec.ts(x) test files; enforce *.test.ts(x) convention instead
const disallowSpecTestsConfig = {
  files: ['**/*.spec.ts', '**/*.spec.tsx'],
  name: 'reelmakeeasy/disallow-spec-tests',
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Program',
        message: 'Use *.test.ts(x) instead of *.spec.ts(x) for tests.',
      },
    ],
  },
}

export default defineConfig([
  ...nxConfigs,
  perfectionist.configs['recommended-natural'],
  sonarjs.configs.recommended,
  nodeDependencies.configs['flat/recommended'],
  eslintPluginTailwindCSS.configs['flat/recommended'],
  unicorn.configs.recommended,
  prettierConfig,
  ignoresConfig,
  projectConfig,
  generalNoRestrictedImportsConfig,
  storyModeRuntimeImportBoundaryConfig,
  promptPurityConfig,
  configFilesConfig,
  testFilesConfig,
  disallowSpecTestsConfig,
  sharedUiNoLocalPrimitivesConfig,
  sharedUiFreezeNewFilesConfig,
  nodeDependenciesConfig,
  noSubPackageDependenciesConfig,
  // Next.js rules for the web app without FlatCompat
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    name: 'reelmakeeasy/web-next',
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-img-element': 'off',
      'no-restricted-syntax': 'off',
      'no-console': 'error',
    },
  },
  // In web app code, direct console usage is blocked by default.
  // Keep explicit exceptions only for the web next config.
  {
    files: ['apps/web/next.config.js'],
    name: 'reelmakeeasy/web-console-exceptions',
    rules: {
      'no-console': 'off',
    },
  },
  // Error handling rules for specific directories
  {
    files: ['{apps,libs,tools}/**/*.{ts,tsx,js,jsx}'],
    name: 'reelmakeeasy/error-handling',
    rules: {
      // prohibit "as Error" type assertions in catch blocks, recommend ensureError() instead
      '@nx/workspace-no-as-error-in-catch': 'warn',
      // enforce structured error logging
      '@nx/workspace-prefer-structured-logger-error': 'error',
    },
  },
  loggerDroppedArgsLegacyConfig,
  // TypeScript-specific rules that require type information
  // {
  //   files: ['{apps,libs,scripts,tools}/**/*.{ts,tsx}'],
  //   name: 'reelmakeeasy/typescript-type-aware',
  //   languageOptions: {
  //     parserOptions: {
  //       project: './tsconfig.base.json',
  //       tsconfigRootDir: import.meta.dirname,
  //     },
  //   },
  //   rules: {
  //     ...typeScriptRules,
  //   },
  // },
])
