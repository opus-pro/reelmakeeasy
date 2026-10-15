export type { Environment } from './eval-environment'

export interface HistoryFilePath {
  baseDir: string
  fileName: string
  projectDir: string
}
export type ToolCall = {
  function: {
    name: string
    parameters: string
  }
  id: string
  type: string
}

export const DEFAULT_PROJECT_HISTORY_PATH: HistoryFilePath = {
  baseDir: 'tmp',
  fileName: 'history.jsonl',
  projectDir: 'projects',
}

export type CanvasSize = {
  height: number
  width: number
}
export type ItemOf<T> = T extends ArrayLike<infer U> ? U : never
