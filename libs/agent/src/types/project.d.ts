// this is the display state of how a scene is deployed
export type ReactionBlock =
  | 'AssetsCollector'
  | 'MotionDesigner'
  | 'Researcher'
  | 'ScriptWriter'
  | 'VoiceActor'
export type SceneStageState = {
  // which block to display, indicate the order of display
  displayBlocks: ReactionBlock[]
  sceneId: string
}
