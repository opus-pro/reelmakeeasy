/**
 * Debug/experimental feature flags stored per-project in MongoDB
 * This structure is extensible - add new categories as needed
 */
export type DebugSettings = {
  keyframeImageModel?: string
  // Future: Add more feature categories here
  llm?: LLMModelSettings
  longTake?: boolean
  render?: RenderDebugSettings
  storyboard?: StoryboardDebugSettings
  transitionVideoModel?: string
}

/**
 * Debug settings for llm models
 */
export type LLMModelSettings = Record<string, Record<string, string>>

export type RenderDebugSettings = {
  watermark?: boolean
}

/**
 * Debug settings for storyboard generation features
 */
export type StoryboardDebugSettings = {
  fixedTemplate?: boolean
  genAI?: boolean
}
