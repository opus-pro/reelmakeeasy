import { exportActivities } from '@shared/render-services/runtime/worker'

import { VideoConcatActivities } from './video-concat.activities'
import { VideoRenderActivities } from './video-render.activities'

export const activityRegistry = exportActivities(VideoRenderActivities, VideoConcatActivities)
