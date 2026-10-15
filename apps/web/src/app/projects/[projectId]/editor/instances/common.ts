import { BaseSegment, Duration, Timeline, Track } from '@reelmakeeasy/common/types/video-script'

import { addSingleId } from '../utils/add-single-id'

import { UpdateListener } from './base'
import { TimeRange } from './time-range'

type CommonParams = {
  duration?: Duration
  id?: string
  timeline: Timeline
}
export abstract class ContentDel extends UpdateListener {
  parent: SegmentDel<ContentDel>

  get timeRange() {
    return this.parent.timeRange
  }

  constructor(params: { id?: string }, parent: SegmentDel<ContentDel>) {
    super(params.id ?? addSingleId('content'))
    this.parent = parent
    this.parent.parent.contentMap.set(this.id, this)
  }

  parse(): void {
    throw new Error('not implemented')
  }
}
export abstract class TimeRangeDel extends UpdateListener {
  timeRange: TimeRange<TimeRangeDel>
  constructor({ duration, timeline, id }: CommonParams) {
    super(id ?? addSingleId('time'))
    this.timeRange = new TimeRange(timeline, duration)
    this.timeRange.parent = this
  }
}

export abstract class SegmentDel<T extends ContentDel> extends TimeRangeDel {
  content!: T
  parent: TrackDel<T>
  get index() {
    return this.parent.segments.findIndex(({ id }) => id === this.id)
  }

  constructor(params: BaseSegment<object>, parent: TrackDel<T>) {
    super({
      duration: params.duration,
      timeline: params.timeline,
      id: params.id ?? addSingleId('segment'),
    })
    this.parent = parent
    this.parent.segmentMap.set(this.id, this)
  }

  parse(): void {
    throw new Error('not implemented')
  }
}

export abstract class TrackDel<T extends ContentDel> extends UpdateListener {
  contentMap = new Map<string, T>()
  segmentMap = new Map<string, SegmentDel<T>>()
  segments: SegmentDel<T>[]
  // for update manager's map key, default is trackType
  type: string

  constructor({ type, id }: { id?: string; type: Track['type'] }) {
    super(id ?? addSingleId('track'))
    this.type = type
    this.segments = []
  }

  parse(): void {
    throw new Error('not implemented')
  }

  removeItem(item: SegmentDel<T>): void {
    const index = this.segments.findIndex((s) => s.id === item.id)
    if (index !== -1) {
      this.segments.splice(index, 1)
    }
    this.segmentMap.delete(item.id)
    if (item.content) {
      this.contentMap.delete(item.content.id)
    }
  }
}
