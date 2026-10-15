import { VideoConcatService } from './concat-video.service'
import { VideoRenderService } from './video-render.service'

export { RENDER_TASK_QUEUE } from './base.service'

// Service classes - for workflow/activity implementations that need `extends`
export { VideoConcatService, VideoRenderService }
