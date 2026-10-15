const { execSync } = require('node:child_process')

function getGitSha() {
  const candidates = [
    process.env.NEXT_PUBLIC_GIT_SHA,
    process.env.COMMIT_ID,
    process.env.GITHUB_SHA,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeSha(candidate)
    if (normalized) {
      return normalized
    }
  }

  const gitSha = resolveFromGit()
  if (gitSha) {
    return gitSha
  }

  return 'unknown'
}

function normalizeSha(value) {
  if (!value) {
    return null
  }
  const trimmed = String(value).trim().replace(/^git-/i, '')
  if (!trimmed) {
    return null
  }
  if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) {
    return null
  }
  return trimmed.toLowerCase().slice(0, 7)
}

function resolveFromGit() {
  try {
    const output = execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    return normalizeSha(output)
  } catch {
    return null
  }
}

module.exports = {
  getGitSha,
}
