import type { ServerRequestHandler } from '../codex/codex-rpc'

/**
 * The part of the Codex app-server client the session service uses. `CodexRpcClient` speaks it
 * to a real `codex app-server`; `ClaudeAppServer` speaks it on top of the Claude Agent SDK, so
 * the session service drives either one the same way.
 */
export interface AgentAppServer {
  close(): void
  notify(method: string): void
  onExit(fn: (code: null | number, reason: string) => void): void
  onNotification(fn: (msg: { method: string; params?: Record<string, unknown> }) => void): void
  onServerRequest(fn: ServerRequestHandler): void
  request<T = unknown>(method: string, params: unknown, opts?: { timeoutMs?: number }): Promise<T>
}
