import { TemplateAssetContent, TemplateAssetTrack } from '@reelmakeeasy/common/types/video-script'
import { ShotVideoScript } from '@shared/types/chat/message-patch-event'

import { TrackDel } from '../common'

import { TemplateContentDel } from './content'
import { TemplateSegmentDel } from './segment'

export class TemplateTrackDel extends TrackDel<TemplateContentDel> {
  override segments: TemplateSegmentDel[]
  constructor(track: TemplateAssetTrack) {
    super(track)
    this.segments = track.segments.map((segment) => new TemplateSegmentDel(segment, this))
  }

  findSegmentsByTime(time: number): TemplateSegmentDel[] | undefined {
    return this.segments.filter(
      (sec) => sec.timeRange.timelineIn <= time && sec.timeRange.timelineOut > time,
    )
  }

  findSegmentsByTimeRange(startMs: number, endMs: number): TemplateSegmentDel[] {
    return this.segments.filter(
      (seg) => seg.timeRange.timelineIn >= startMs && seg.timeRange.timelineOut <= endMs,
    )
  }

  override parse(): TemplateAssetTrack {
    return {
      id: this.id as TemplateAssetTrack['id'],
      type: 'template-asset',
      segments: this.segments.map((section) => section.parse()),
    }
  }

  updateFromShotVideoScript(script: ShotVideoScript): void {
    script.forEach((item) => {
      if (!item.segId) {
        return
      }

      const segment = this.segmentMap.get(item.segId)
      if (segment && segment.content instanceof TemplateContentDel) {
        const newContent: TemplateAssetContent = {
          id: segment.content.id as TemplateAssetContent['id'],
          layoutId: item.content.layoutId,
          params: item.content.params as TemplateAssetContent['params'],
          targetAreas: item.content.targetAreas,
        }
        segment.content.update(newContent)
      }
    })
  }
}
