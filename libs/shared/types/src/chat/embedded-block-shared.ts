export type ConfirmCountdown = {
  autoConfirm?: boolean
  defaultResult?: string
  durationMs?: number
  // Date
  startedAt: string
}
export interface ConfirmProgressiveCardContent {
  confirmed?: boolean
  confirmedResult?: string
  countdown?: ConfirmCountdown
  error?: string
  needConfirm?: boolean
  ready?: boolean

  title?: string
}
export type FeedbackContentExt = {
  feedback?: FeedbackFields
}
export type FeedbackFields = {
  dislikeCustomReason?: string
  // for option value
  dislikeOption?: string
  liked?: boolean | null
  updatedAt?: string
}
export interface ProgressiveCardContent {
  ready?: boolean
}
