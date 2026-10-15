const { composePlugins, withNx } = require('@nx/next')
// eslint-disable-next-line @nx/enforce-module-boundaries -- build-time-only helper; scripts/ is not an nx project, so there is no importable alias for it
const { getGitSha } = require('../../scripts/build-tools/get-git-sha.js')

const gitSha = getGitSha()

const fs = require('node:fs')
const path = require('node:path')

// The editor's preview engine and its fonts ship in the preset pack, which the
// API serves. Set NEXT_PUBLIC_WASM_PATH to load the engine from somewhere else.
const EDITOR_WASM_PRESET = 'editor/AVEditorEngine.wasm.gz'
const presetPackVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../presets/pack.json'), 'utf8'),
).version
const presetPackUrl = `${process.env.NEXT_PUBLIC_API_ORIGIN || 'http://localhost:5017'}/api/presets/${presetPackVersion}`
const editorWasmPath = process.env.NEXT_PUBLIC_WASM_PATH || `${presetPackUrl}/${EDITOR_WASM_PRESET}`

const nextConfig = {
  // Next 16.3 defaults `experimental.useTypeScriptCli` to true, which type-checks
  // `next build` with plain `tsc` over the whole tsconfig and drops the
  // framework's TypeScript-API filter that ignores *.test.* / *.spec.* /
  // __tests__ / __mocks__. Keep the API checker so the test-file type debt
  // (never checked by production builds on 16.2) does not fail the build.
  experimental: {
    useTypeScriptCli: false,
  },
  // Images load as-is (from the local API and the app's own public folder): no optimizer, so
  // no remote hosts to allow.
  images: {
    unoptimized: true,
  },
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
  env: {
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN || '',
    NEXT_PUBLIC_GIT_SHA: gitSha,
    NEXT_PUBLIC_PRESET_PACK_URL: presetPackUrl,
    NEXT_PUBLIC_WASM_PATH: editorWasmPath,
  },
  // `pnpm reelmakeeasy start` builds and serves the web app from its own folder (.next-prod), so a
  // production build never touches the `.next` that a running `pnpm dev` uses.
  // The build folder `pnpm reelmakeeasy` picks (WEB_DIST_DIR).
  ...(process.env.WEB_DIST_DIR
    ? { distDir: process.env.WEB_DIST_DIR }
    : {}),
  devIndicators: false,
  reactStrictMode: true,
  // Same-origin /api calls go to the API, in dev and in a production build alike.
  async rewrites() {
    return [
      {
        // DEV_API_PROXY_TARGET points the proxy at an API on another host or port.
        destination: `${process.env.DEV_API_PROXY_TARGET || 'http://localhost:5017'}/api/:path*`,
        source: '/api/:path*',
      },
    ]
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = { type: 'memory' }
    }
    // Tailwind v3's PostCSS plugin registers content directories via
    // addContextDependency(), not individual files via addDependency().
    // Webpack's persistent cache only invalidates on directory-listing changes
    // (files added/removed), not file content changes. Adding a new Tailwind
    // arbitrary-value class to an existing component therefore does not bust
    // the CSS chunk. Setting cache=false in CI forces a full Tailwind re-scan.
    if (process.env.CI) {
      config.cache = false
    }
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...config.resolve.alias,
      '@shared/ui': path.resolve(__dirname, '../../libs/shared/ui/src'),
      '@reelmakeeasy/common': path.resolve(__dirname, '../../libs/shared/common/src'),
      '@shared/types': path.resolve(__dirname, '../../libs/shared/types/src'),
    }

    config.module.rules.push(
      // Rive (.riv) animations imported as a bundled asset URL (used by shared/ui's AgentThinkingIcon)
      {
        test: /\.riv$/i,
        type: 'asset/resource',
      },
      // The editor engine's glue, once more as a raw file: the engine's audio thread runs in
      // an AudioWorklet that `addModule`s the same glue, and a worklet needs a plain module
      // URL, not a webpack chunk. Served from this origin (immutable, offline) rather than
      // fetched from elsewhere on every engine start, which kept the narration silent until it
      // arrived.
      {
        resourceQuery: /raw/, // AVEditorEngine.mjs?raw
        test: /AVEditorEngine\.mjs$/,
        type: 'asset/resource',
      },
    )

    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find(
      (rule) => rule.test instanceof RegExp && rule.test.test('.svg'),
    )

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...(fileLoaderRule.resourceQuery?.not || []), /url/] }, // exclude if *.svg?url
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              // Keep original SVG attributes (including viewBox) by disabling SVGO optimizations
              svgo: false,
            },
          },
        ],
      },
    )

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i

    return config
  },
  async headers() {
    return [
      {
        source: '/(editor|projects|story-mode)/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
      {
        // The agent page previews finished videos with the editor's engine.
        source: '/agent',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      // Pages that no longer exist: send old links home.
      {
        source: '/discover',
        destination: '/home',
        permanent: true,
      },
      {
        source: '/videos',
        destination: '/home',
        permanent: true,
      },
      {
        source: '/videos/:path*',
        destination: '/home',
        permanent: true,
      },
    ]
  },
}

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
]

// module.exports = nextConfig
module.exports = composePlugins(...plugins)(nextConfig)
