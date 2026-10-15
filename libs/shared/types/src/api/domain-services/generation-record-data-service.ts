export interface GenerationRecordCreateData {
  anchorId?: null | string
  anchorType?: null | string
  attempt: number
  errorMessage?: null | string
  errorName?: null | string
  errorStack?: null | string
  inputText?: null | string
  inputUris?: string[]
  meta?: unknown
  model?: null | string
  outputText?: null | string
  outputUris?: string[]
  projectId: string
  stagingError?: null | string
  stagingStatus?: GenerationRecordStagingStatus
  status: GenerationRecordStatus
  task: string
  taskId: string
  type: GenerationRecordType
  userId?: null | string
}
export interface GenerationRecordDataService {
  createRecord(data: GenerationRecordCreateData): Promise<{ id: string }>
  patchRecordUris(data: GenerationRecordPatchUrisData): Promise<void>
}
export interface GenerationRecordPatchUrisData {
  id: string
  inputUris?: string[]
  outputUris?: string[]
  stagingError?: null | string
  stagingStatus?: GenerationRecordStagingStatus
}

export type GenerationRecordStagingStatus = 'failed' | 'pending' | 'ready'

export type GenerationRecordStatus = 'failed' | 'success'

export type GenerationRecordType = 'image' | 'llm' | 'video'
