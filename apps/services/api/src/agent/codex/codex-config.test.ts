import os from 'node:os'
import path from 'node:path'

import { buildAppServerArgs, codexHome, scrubCodexEnv } from './codex-config'

describe('codex config', () => {
  it('buildAppServerArgs returns the exact ReelMakeEasy argv, web search disabled by default', () => {
    const argv = [
      'app-server',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '--enable',
      'default_mode_request_user_input',
      '-c',
      'model_reasoning_summary="detailed"',
    ]
    expect(buildAppServerArgs()).toEqual([...argv, '-c', 'web_search="disabled"'])
    expect(buildAppServerArgs({ webSearch: false })).toEqual([
      ...argv,
      '-c',
      'web_search="disabled"',
    ])
    expect(buildAppServerArgs({ webSearch: true })).toEqual([...argv, '-c', 'web_search="live"'])
  })

  it('buildAppServerArgs drops the shell tools when asked, keeping live web search', () => {
    expect(buildAppServerArgs({ shell: false, webSearch: true })).toEqual([
      'app-server',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '--disable',
      'shell_tool',
      '--disable',
      'unified_exec',
      '--enable',
      'default_mode_request_user_input',
      '-c',
      'model_reasoning_summary="detailed"',
      '-c',
      'web_search="live"',
    ])
  })

  it('buildAppServerArgs with web search off keeps the shell tools', () => {
    expect(buildAppServerArgs({ webSearch: false })).toEqual([
      'app-server',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '--enable',
      'default_mode_request_user_input',
      '-c',
      'model_reasoning_summary="detailed"',
      '-c',
      'web_search="disabled"',
    ])
  })

  describe('codexHome', () => {
    it('honours CODEX_HOME and defaults to ~/.codex', () => {
      expect(codexHome({ CODEX_HOME: '/custom/codex-home' })).toBe('/custom/codex-home')
      expect(codexHome({})).toBe(path.join(os.homedir(), '.codex'))
    })
  })

  describe('scrubCodexEnv', () => {
    const env = {
      ANTHROPIC_API_KEY: 'a',
      CODEX_HOME: '/c',
      DATABASE_URL: 'mongodb://x',
      ELEVENLABS_API_KEY: 'e',
      FAL_KEY: 'f',
      GEMINI_API_KEY: 'g',
      HOME: '/home/u',
      LLM_API_KEY: 'l',
      LLM_BASE_URL: 'https://llm',
      OPENAI_API_KEY: 'o',
      PATH: '/bin',
    }

    it("removes ReelMakeEasy's secrets and other *_API_KEY vars, keeping the rest", () => {
      expect(scrubCodexEnv(env)).toEqual({
        CODEX_HOME: '/c',
        HOME: '/home/u',
        LLM_BASE_URL: 'https://llm',
        OPENAI_API_KEY: 'o',
        PATH: '/bin',
      })
    })

    it('keeps env vars named in the keep option, but never the ReelMakeEasy ones', () => {
      const scrubbed = scrubCodexEnv(env, { keep: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] })
      expect(scrubbed.ANTHROPIC_API_KEY).toBe('a')
      expect(scrubbed.GEMINI_API_KEY).toBeUndefined()
    })

    it('does not modify its input', () => {
      const input = { ...env }
      scrubCodexEnv(input)
      expect(input).toEqual(env)
    })

    it('removes the file-signing secret and keeps the data folder', () => {
      const scrubbed = scrubCodexEnv({ DATA_DIR: '/d', FILE_SIGNING_SECRET: 's' })
      expect(scrubbed).toEqual({ DATA_DIR: '/d' })
    })
  })
})
