import { exportWorkflows } from '@shared/render-services/runtime/workflow'

import { VideoConcatWorkflows } from './video-concat.workflows'
import { VideoRenderWorkflows } from './video-render.workflows'

/** Workflows */
export const { RenderPreview, RenderVideo, RenderVideoChunked } =
  exportWorkflows(VideoRenderWorkflows)
export const { ConcatVideo } = exportWorkflows(VideoConcatWorkflows)
