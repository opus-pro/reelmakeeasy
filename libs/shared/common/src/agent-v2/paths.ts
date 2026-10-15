export const SCRIPT_WRITER_PATHS = {
  rawScriptPath: 'story_loader/raw_script.txt',
} as const

export const STORY_LOADER_PATHS = {
  providedScriptPath: 'story_loader/provided_script.txt',
  transformedTranscriptPath: 'story_loader/transcript/transformed_transcript.json',
  scriptTxtPath: 'story_loader/script.txt',
  annotatedScriptJsonPath: 'story_loader/annotated_script.json',
  audioVoiceoverPath: 'story_loader/audio/voice_over.mp3',
  globalConstraintsPath: 'story_loader/global_constraints.json',
  globalConstraintsPromptPath: 'story_loader/global_constraints_prompt.txt',
  visualScriptPath: 'story_loader/visual_script.json',
  visualScriptPromptPath: 'story_loader/visual_script_prompt.txt',
  retrievalIntentsPath: 'story_loader/retrieval_intents.json',
} as const

export const AVATAR_PATHS = {
  dir: 'avatar',
  requestsPath: 'avatar/avatar_requests.json',
  selectedScenesPath: 'avatar/selected_scenes.json',
  shotsDetailPath: 'avatar/avatar_shots_detail.json',
  metadataPath: 'avatar/metadata.json',
  videoPath: (sceneId: string) => `avatar/video/${sceneId}_avatar.mp4`,
  voicePath: (sceneId: string) => `avatar/voice/${sceneId}.mp3`,
} as const

export const STORYBOARD_PATHS = {
  scenesTranscriptPath: 'storyboard/scenes.json',
  shotsBaseInfoPath: 'storyboard/storyboard.json',
  splitShotsPath: 'storyboard/split_shots.json',
  sceneShotInfoPath: 'storyboard/scene_shot_info.json',
  templateSelectionReasoningPath: 'storyboard/template_selection_reasoning.json',
  plansImageEvaluationShotPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/plans_image_evaluation.json`,
  plansImageEvaluationSentPath: 'storyboard/plans_image_evaluation_sent.json',
  scenePath: (sceneId: string) => `storyboard/${sceneId}`,
  sceneAllAssetsPath: (sceneId: string) => `storyboard/${sceneId}/all_assets.json`,
  sceneReferencesPath: (sceneId: string) => `storyboard/${sceneId}/references.json`,
  sceneReferencesBeforeDedupPath: (sceneId: string) =>
    `storyboard/${sceneId}/references_before_dedup.json`,
  shotReferencesPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/references.json`,
  sceneAssetTracePath: (sceneId: string) => `storyboard/${sceneId}/asset_trace.json`,
  reframeTracePath: (sceneId: string) => `storyboard/${sceneId}/reframe_trace.json`,
  styleConfigPath: 'storyboard/style_config.json',
  copyStylePath: 'storyboard/copy_style.json',
  userUploadedStyleImagePath: 'storyboard/user_uploaded_style.png',
  fontsDir: 'storyboard/fonts',
  defaultBackgroundPath: 'storyboard/default_background.png',
  fwaStyleConfigPath: 'storyboard/fwa_style_config.json',
  fwaCopyStylePath: 'storyboard/fwa_copy_style.json',
  fwaFontsDir: 'storyboard/fwa_fonts',
  fwaDefaultBackgroundPath: 'storyboard/fwa_default_background.png',
  // Legacy avatar paths - use AVATAR_PATHS for new code
  avatarDir: AVATAR_PATHS.dir,
  avatarSelectedScenesPath: AVATAR_PATHS.selectedScenesPath,
  avatarShotsDetailPath: AVATAR_PATHS.shotsDetailPath,
  avatarMetadataPath: AVATAR_PATHS.metadataPath,
  shotVideoScriptPreviewPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/shot_video_script_preview.json`,
  shotPreviewImagePath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/shot_preview_image.png`,
  shotBestPlanPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/shot_best_plan.json`,
  shotTemplateSystemPrePlanPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/template_system_pre_plan.json`,
  shotEvaluatorInputPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/evaluator_input.json`,
  shotFillingStrategyPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/filling_strategy.json`,
  shotFixedTemplatePath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/fixed_template.json`,
  shotCodegenTemplatePath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/codegen_template.json`,
  shotFullscreenBackgroundStrategyPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/fullscreen_background_strategy.json`,
  shotQuoteTemplateSelectionPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/quote_template_selection.json`,
  // GenAI plan paths
  shotGenAiSubjectsSelectionPath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/subjects_selection.json`,
  shotGenAiShotDescriptionPath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/shot_description.json`,
  shotGenAiFirstFrameEditingPromptPath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/first_frame_editing_prompt.json`,
  shotGenAiVeoPromptPath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/veo_prompt.txt`,
  shotGenAiAiFinalRenderPlanPath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/ai_final_render_plan.json`,
  // Gen AI image paths
  shotGenAiLastFramePath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/LastFrame.png`,
  shotGenAiFirstFramePath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/FirstFrame.png`,
  shotGenAiLastFrameStyleTransferPath: (sceneId: string, shotId: string, planIdx: number) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/LastFrame_style_transfer.png`,
  shotGenAiResizedAssetPath: (sceneId: string, shotId: string, planIdx: number, assetId: string) =>
    `storyboard/${sceneId}/${shotId}/gen_ai_plan_${planIdx}/${assetId}_resized.png`,
  // Codegen background paths
  shotCodegenFramePath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/codegen_frame.png`,
  shotCodegenBackgroundPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/codegen_background.png`,
  shotCodegenBlueprintPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/codegen_blueprint.json`,
  shotCodegenTemplateJsonPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/codegen_template.json`,
  // Asset manifest paths
  shotAssetManifestPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/asset_manifest.json`,
  shotAssetManifestPromptPath: (sceneId: string, shotId: string) =>
    `storyboard/${sceneId}/${shotId}/asset_manifest_prompts/asset_manifest_prompt.txt`,
  videoScriptPath: 'storyboard/video_script.json',
  finalVideoPath: 'storyboard/final_video.mp4',
  motionDesignerMessagesPath: 'storyboard/motion_designer_messages.json',
  // Summary paths (root level, not in storyboard/ subdirectory)
  storyboardSummaryPath: 'storyboard_summary.md',
  storyboardSceneStatusPath: 'scene_status.md',
} as const

export const OUTPUT_PATHS = {
  scenePreviewImagePath: (sceneId: string) => `storyboard/previews/preview_image_${sceneId}.png`,
  finalVideoPath: 'final_video.mp4',
  watermarkVideoPath: 'watermark_video.mp4',
} as const

/**
 * Common directory paths
 */
export const COMMON_DIRS = {
  STORYBOARD: 'storyboard',
  STORY_LOADER: 'story_loader',
  VIDEO_CREW: 'video_crew',
  USER_UPLOADED: 'user_uploaded',
} as const

export const EVAL_PATHS = {
  dbAccessLayerDumpPath: 'eval/db-access-layer-dump.json',
} as const
