import { claudeModel, defaultHarness, scrubClaudeEnv } from './claude-config'

describe('scrubClaudeEnv', () => {
  const env = {
    ANTHROPIC_API_KEY: 'a',
    ANTHROPIC_BASE_URL: 'b',
    CLAUDE_CODE_ENTRYPOINT: 'x',
    CLAUDE_CODE_MESSAGING_TOKEN: 't',
    CLAUDE_CODE_SESSION_ID: 's',
    CLAUDE_CONFIG_DIR: '/c',
    CLAUDE_PID: '9',
    CLAUDECODE: '1',
    DATABASE_URL: 'mongodb://x',
    FAL_KEY: 'f',
    GEMINI_API_KEY: 'g',
    HOME: '/h',
    OPENAI_API_KEY: 'o',
    PATH: '/bin',
    SOME_API_KEY: 'k',
  }

  it("drops ReelMakeEasy's secrets and other keys but keeps Claude's own", () => {
    const out = scrubClaudeEnv(env)
    expect(out).toMatchObject({
      ANTHROPIC_API_KEY: 'a',
      ANTHROPIC_BASE_URL: 'b',
      CLAUDE_CONFIG_DIR: '/c',
      HOME: '/h',
      PATH: '/bin',
    })
    for (const k of ['DATABASE_URL', 'FAL_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'SOME_API_KEY'])
      expect(out).not.toHaveProperty(k)
  })

  it('drops the variables a parent Claude Code session sets', () => {
    const out = scrubClaudeEnv(env)
    for (const k of [
      'CLAUDECODE',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_PID',
    ])
      expect(out).not.toHaveProperty(k)
  })

  it('names ReelMakeEasy as the SDK client', () => {
    expect(scrubClaudeEnv({}).CLAUDE_AGENT_SDK_CLIENT_APP).toBe('reelmakeeasy/1')
  })
})

describe('claudeModel / defaultHarness', () => {
  it('defaults to Opus 5.5 and Codex', () => {
    expect(claudeModel({})).toBe('claude-opus-5-5')
    expect(defaultHarness({})).toBe('codex')
  })

  it('reads the env, ignoring junk', () => {
    expect(claudeModel({ CLAUDE_AGENT_MODEL: ' claude-sonnet-5 ' })).toBe('claude-sonnet-5')
    expect(defaultHarness({ AGENT_HARNESS: 'Claude' })).toBe('claude')
    expect(defaultHarness({ AGENT_HARNESS: 'gemini' })).toBe('codex')
  })
})
