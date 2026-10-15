/**
 * Visual Analysis
 */
export enum AnalysisResultType {
  ActiveSpeaker = 'activeSpeaker',

  Face = 'face',

  /** Faces with identifier, crop position, faceness value, activeness value, etc. */
  FaceV2 = 'faceV2',

  /**
   * @deprecated
   * Indexes of fake faces, this is a reserved field that has never been used in refineV2/EditorV2.
   *
   * Note that the fake face id is not accurate if there in only single face in a segment,
   * check reason in comments in getFakeFaceIdsV1.ts.
   */
  FakeFace = 'fakeFace',

  // List of fake face crops
  FakeFaceCrops = 'fakeFaceCrops',

  Grid = 'grid',

  MovingSpeaker = 'movingSpeaker',
  People = 'people',
  /** Peoples with face identifier, crop position, peopleness value, activeness value, etc. */
  PeopleV2 = 'peopleV2',
  Screen = 'screen',
  TrackingSubjects = 'trackingSubjects',
}

/**
 * Captions
 */
export enum CaptionColorType {
  Default = 0,
  Primary = 1,
  Secondary = 2,
}
export enum FadeMode {
  Bezier = 'bezier',
  Linear = 'linear',
}

/**
 * KeyFrame
 */
export enum KeyFrameLayoutType {
  Default = 'Default',
  Fill = 'Fill',
  Fit = 'Fit',
  Four = 'Four',
  Game = 'Game',
  ScreenShare = 'ScreenShare',
  Split = 'Split',
  Three = 'Three',
}
export enum KeyFrameResourceType {
  Gif = 'gif',
  Image = 'image',
  Video = 'video',
}
export enum MovingSpeakerType {
  NotDetected = 'NotDetected',
  Off = 'Off',
  On = 'On',
}
export enum PlayMode {
  Freeze = 'freeze',
  Normal = 'normal',
}

// TODO: split to post-processors and post-sub-processors
export enum PostProcessorNames {
  AddAiGeneratedContent = 'AddAiGeneratedContent',
  AddBRoll = 'AddBRoll',
  AddIntroOutro = 'AddIntroOutro',
  AddVoiceEnhancement = 'AddVoiceEnhancement',

  AddVoiceOver = 'AddVoiceOver',
  RemoveFillerWords = 'RemoveFillerWords',

  RemovePauses = 'RemovePauses',
  UnifyTrack = 'UnifyTrack',
}
export enum RefineSteps {
  BuildContext = 'BuildContext',
  ExtractFrame = 'ExtractFrame',
  GenerateReframingScene = 'GenerateReframingScene',
}
export enum RefineWorkflowNames {
  Default = 'Default',
}
export enum SubAnalyzerNames {
  DefaultActiveSpeakerDetection = 'DefaultActiveSpeakerDetection',
  DefaultFaceDetection = 'DefaultFaceDetection',
}
export enum SubProcessorNames {
  DefaultFakeFaceFiltering = 'DefaultFakeFaceFiltering',
  DefaultGeneralTracking = 'DefaultGeneralTracking',
  DefaultKeyframeDetermination = 'DefaultKeyframeDetermination',
  DefaultObjectDetection = 'DefaultObjectDetection',
  DefaultVllmGridCrop = 'DefaultVllmGridCrop',
}
export enum TextOverlayType {
  Heading = 'heading',
  Paragraph = 'paragraph',
}

/**
 * TrackingProperties
 * Add to segment level of the key frame track
 */
export enum TrackingProperties {
  /** reserved property for moving speaker */
  MOVING_SPEAKER = 'movingSpeaker',
}

/**
 * TrackingType is used with TrackingProperties
 */
export enum TrackingType {
  NotDetected = 'NotDetected',
  Off = 'Off',
  On = 'On',
}

/**
 * Transition Effects
 * Which will change the timeline of the video
 */
export enum TransitionType {
  NotSet = 'notSet',
}

/**
 * Animation Effects
 * Which will not change the timeline of the video
 */
export enum VideoEffectType {
  CrossFade = 'crossFade',
  CrossZoom = 'crossZoom',
  FadeIn = 'fadeIn',
  FadeOut = 'fadeOut',
  ZoomIn = 'zoomIn',
  ZoomOut = 'zoomOut',
}

/**
 * VoiceOverProperties
 * Add to section level of the track
 */
export enum VoiceOverProperties {
  END = 'end',
  SCRIPT = 'script',
  SOURCE_URI = 'sourceUri',
  SPEAKER = 'speaker',
  STABILITY = 'stability',
  START = 'start',
  VO_TYPE = 'voType',
  VOLUME = 'volume',
}
export enum ZoomMode {
  Bezier = 'bezier',
  Linear = 'linear',
}
