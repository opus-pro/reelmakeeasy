/**
 * Resolve the transition-video-model id for the Story Mode model badge.
 *
 * Unlike the other detail-panel fields (style, ratio, image model) -- which have
 * artifacts/template fallbacks and so render correctly during the fast-confirm
 * processing window -- the video badge is sourced solely from
 * `project.debugSettings.transitionVideoModel`, which is not written until the
 * confirm step. While the project record catches up (see the projectInfo poll
 * in LongTakeViewer) the badge would briefly show the "Seedance 1.5" default, so
 * we fill the gap with the authoritative UipSession value, which is set the
 * instant the user picks the model. The project value wins once present (it is
 * ground truth for what generation uses).
 *
 * @param projectVideoModel `project.debugSettings.transitionVideoModel ?? null`.
 * @param sessionVideoModel UipSession `transition_video_model`; `undefined` =
 *   not loaded yet, `null` = Seedance 1.5 default.
 */
export function resolveUipBadgeVideoModel({
  projectVideoModel,
  sessionVideoModel,
}: {
  projectVideoModel: null | string
  sessionVideoModel: null | string | undefined
}): null | string {
  return projectVideoModel ?? sessionVideoModel ?? null
}
