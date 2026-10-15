import type { AgentStatusResponse, HarnessStatus } from '@shared/types/api/agent'

import {
  agentPickerRows,
  anyHarnessReady,
  harnessChoices,
  initialHarness,
  unavailableMessage,
} from './agent-harness'

const ready: HarnessStatus = { available: true, binary: '/b', loggedIn: true, version: '1' }
const signedOut: HarnessStatus = {
  available: false,
  binary: '/b',
  loggedIn: false,
  reason: 'not-logged-in',
  version: '1',
}
const missing: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}
const status = (
  codex: HarnessStatus,
  claude: HarnessStatus,
  defaultHarness: 'claude' | 'codex' = 'codex',
): AgentStatusResponse => ({ ...codex, claude, codex, defaultHarness })

describe('agent harness helpers', () => {
  it('lists installed harnesses, disabling a signed-out one with how to fix it', () => {
    expect(harnessChoices(status(ready, missing))).toEqual([{ harness: 'codex' }])
    expect(harnessChoices(status(ready, signedOut))).toEqual([
      { harness: 'codex' },
      {
        disabledReason: 'Sign in to Claude Code: run claude login in a terminal',
        harness: 'claude',
      },
    ])
    expect(harnessChoices(null)).toEqual([])
  })

  it('preselects the default when ready, else the ready one', () => {
    expect(initialHarness(status(ready, ready, 'claude'))).toBe('claude')
    expect(initialHarness(status(ready, signedOut, 'claude'))).toBe('codex')
    expect(initialHarness(status(missing, ready))).toBe('claude')
    expect(initialHarness(null)).toBe('codex')
  })

  it('opens a chat when either harness is ready, and says what to install otherwise', () => {
    expect(anyHarnessReady(status(missing, ready))).toBe(true)
    expect(anyHarnessReady(status(missing, missing))).toBe(false)
    expect(unavailableMessage(status(missing, missing))).toBe(
      'Install Codex or Claude Code to use Agent mode',
    )
    expect(unavailableMessage(status(signedOut, missing))).toBe('Open ChatGPT and sign in to Codex')
    expect(unavailableMessage(status(missing, signedOut))).toBe(
      'Sign in to Claude Code: run claude login in a terminal',
    )
  })
})

describe('a status reply without the harness fields (an older API, or a partial reply)', () => {
  const old = { ...ready } as unknown as AgentStatusResponse

  it('reads the top-level fields as Codex and Claude Code as not installed', () => {
    expect(harnessChoices(old)).toEqual([{ harness: 'codex' }])
    expect(initialHarness(old)).toBe('codex')
    expect(anyHarnessReady(old)).toBe(true)
    expect(unavailableMessage({} as AgentStatusResponse)).toBe(
      'Install Codex or Claude Code to use Agent mode',
    )
  })
})

describe('Claude Code without its shell sandbox', () => {
  it('says what to install', () => {
    const noSandbox: HarnessStatus = { ...signedOut, loggedIn: true, reason: 'no-sandbox' }
    expect(unavailableMessage(status(missing, noSandbox))).toBe(
      'Claude Code needs bubblewrap and socat on this machine: install them, then try again',
    )
  })
})

describe('agentPickerRows (the Agent dialog)', () => {
  it('shows both agents as checking while the status loads', () => {
    expect(agentPickerRows(null)).toEqual([
      { harness: 'codex', label: 'Codex', state: 'checking' },
      { harness: 'claude', label: 'Claude Code', state: 'checking' },
    ])
  })

  it('marks ready agents and greys out the rest with the reason', () => {
    expect(agentPickerRows(status(ready, signedOut))).toEqual([
      { harness: 'codex', label: 'Codex', state: 'ready' },
      {
        harness: 'claude',
        label: 'Claude Code',
        reason: 'Sign in: run claude login in a terminal',
        state: 'unavailable',
      },
    ])
    expect(agentPickerRows(status(missing, missing)).map((r) => r.reason)).toEqual([
      'Not installed',
      'Not installed',
    ])
  })
})
