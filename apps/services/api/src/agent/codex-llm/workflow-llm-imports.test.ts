import fs from 'node:fs'
import path from 'node:path'

/**
 * Codex routing (`currentLlmProjectId`) finds a call's project through JobContext or the
 * running activity; a workflow body has no such guarantee across its awaits. So workflow
 * code must never call an LLM itself: only its activities may. This guards the story-mode
 * workflows against importing an LLM client directly.
 */

function repoRoot(): string {
  let dir = __dirname
  while (!fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const up = path.dirname(dir)
    if (up === dir) throw new Error('repo root not found')
    dir = up
  }
  return dir
}

const ROOT = repoRoot()
const WORKFLOWS = path.join(ROOT, 'libs', 'story-mode-runtime', 'src', 'workflows')
/** Where the LLM clients live, for relative imports. */
const LLM_DIRS = [
  path.join(ROOT, 'libs', 'llm'),
  path.join(ROOT, 'libs', 'shared', 'common', 'src', 'llm'),
]
const LLM_ALIASES = [
  /^@reelmakeeasy\/llm(\/|$)/,
  /^@reelmakeeasy\/common\/llm(\/|$)/,
  /(^|\/)libs\/llm(\/|$)/,
]
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : []
  })
}

/** The LLM-client import specifiers in `source` (a file at `file`). */
function llmImports(file: string, source: string): string[] {
  return [...source.matchAll(SPECIFIER)]
    .map((m) => m[1])
    .filter((spec) => {
      if (LLM_ALIASES.some((re) => re.test(spec))) return true
      if (!spec.startsWith('.')) return false
      const target = path.resolve(path.dirname(file), spec)
      return LLM_DIRS.some((dir) => target === dir || target.startsWith(dir + path.sep))
    })
}

describe('story-mode workflow bodies', () => {
  it('detects every way of importing an LLM client (self-check)', () => {
    const file = path.join(WORKFLOWS, 'long-take', 'workflow.ts')
    const source = [
      "import { LLM } from '@reelmakeeasy/llm'",
      "import type { Model } from '@reelmakeeasy/llm/types'",
      "import { completion } from '@reelmakeeasy/common/llm/completion'",
      "const m = await import('../../../../llm/src/index')",
      "const r = require('../../../../shared/common/src/llm')",
      "import '../../../../llm/src/chat'",
      "import { ok } from '@reelmakeeasy/common/logger'",
      "import { llmish } from './llm-helpers'",
    ].join('\n')
    expect(llmImports(file, source)).toEqual([
      '@reelmakeeasy/llm',
      '@reelmakeeasy/llm/types',
      '@reelmakeeasy/common/llm/completion',
      '../../../../llm/src/index',
      '../../../../shared/common/src/llm',
      '../../../../llm/src/chat',
    ])
  })

  it('never import an LLM client (only activities may call one)', () => {
    const files = sourceFiles(WORKFLOWS)
    expect(files.length).toBeGreaterThan(10)
    const offenders = files.flatMap((file) =>
      llmImports(file, fs.readFileSync(file, 'utf8')).map(
        (spec) => `${path.relative(ROOT, file)}: ${spec}`,
      ),
    )
    expect(offenders).toEqual([])
  })
})
