import { BaseSegment, Position, TemplateAssetContent } from '@reelmakeeasy/common/types/video-script'

import { SegmentDel } from '../common'

import { TemplateContentDel } from './content'
import { type TemplateTrackDel } from './track'

export class TemplateSegmentDel extends SegmentDel<TemplateContentDel> {
  override parent: TemplateTrackDel
  get position() {
    return this._position
  }

  get scale() {
    return this._scale
  }

  private _position: Position

  private _scale?: number

  constructor(segment: BaseSegment<TemplateAssetContent>, parent: TemplateTrackDel) {
    super(segment, parent)
    this.parent = parent
    this._position = segment.position ?? {
      xPct: 0,
      yPct: 0,
      wPct: 1,
      hPct: 1,
    }
    this._scale = segment.scale
    this.content = new TemplateContentDel(segment.content, this)
  }

  override parse(): BaseSegment<TemplateAssetContent> {
    return {
      content: this.content.parse(),
      id: this.id as BaseSegment<TemplateAssetContent>['id'],
      position: this._position,
      scale: this._scale,
      ...this.timeRange.parse(),
    }
  }

  updatePosition(value: Position): void {
    this._position = value
  }

  updateScale(value: number): void {
    this._scale = value
  }
}
