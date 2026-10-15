import { Duration, Timeline } from '@reelmakeeasy/common/types/video-script'

import { addSingleId } from '../utils/add-single-id'

import { UpdateListener } from './base'

export class TimeRange<T extends UpdateListener = UpdateListener> extends UpdateListener {
  override parent?: T = undefined
  get duration() {
    return (this.end ?? 0) - (this.start ?? 0)
  }
  get end() {
    return this._eOAdj ?? this._eO
  }
  set end(value: number | undefined) {
    this._eOAdj = value
  }
  get start() {
    return this._sOAdj ?? this._sO
  }
  set start(value: number | undefined) {
    this._sOAdj = value
  }
  set timelineIn(value: number) {
    this._timelineIn = value
  }

  get timelineIn() {
    return this._timelineIn
  }

  set timelineOut(value: number) {
    this._timelineOut = value
  }

  get timelineOut() {
    return this._timelineOut
  }

  private _eO?: number

  private _eOAdj?: number

  private _sO?: number

  private _sOAdj?: number

  private _timelineIn: number

  private _timelineOut: number

  constructor(timeline: Timeline, duration?: Duration) {
    super(addSingleId('time'))
    this._sO = duration?.sO
    this._eO = duration?.eO
    this._sOAdj = duration?.sOAdj
    this._eOAdj = duration?.eOAdj
    this._timelineIn = timeline.in
    this._timelineOut = timeline.out
  }

  parse(): {
    duration: { eO?: number; eOAdj?: number; sO?: number; sOAdj?: number }
    timeline: { in: number; out: number }
  } {
    return {
      duration: {
        sO: this._sO,
        eO: this._eO,
        sOAdj: this._sOAdj,
        eOAdj: this._eOAdj,
      },
      timeline: {
        in: this._timelineIn,
        out: this._timelineOut,
      },
    }
  }
}
