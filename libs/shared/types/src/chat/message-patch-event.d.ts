import { Project } from '../api/project'

import { ChatBoxFrontEndExtra } from './shared'

export type BaseUpdateEventMessage = {
  from?: 'agent' | 'user'
  id?: string
  role: 'event'
}

export type PatchEventMessage = ChatBoxFrontEndExtra &
  (ProgressEventMessage | ProjectPatchMessage | VideoScriptPatchMessage)

export type ProgressEventMessage = BaseUpdateEventMessage & {
  content: {
    data: {
      target?: number
      updatedAt: Date
      value: number
    }
  }
  type: 'progress'
}

export type ProjectPatchMessage = BaseUpdateEventMessage & {
  content: {
    data: Partial<Project>
  }
  type: 'project-patch'
}

export type ShotVideoScript = Array<{
  content: {
    layoutId: string
    params: Record<string, unknown>
    targetAreas?: Array<{
      frameTime: number
      layoutType?: 'fill' | 'fit'
      mode: 'bezier' | 'linear'
      position: {
        hPct?: number
        wPct?: number
        xPct: number
        yPct: number
      }
    }>
  }
  segId?: string
  timeline?: {
    in: number
    out: number
  }
}>

export type VideoScriptPatchMessage = BaseUpdateEventMessage & {
  content: {
    data: ShotVideoScript
  }
  type: 'vs-patch'
}
