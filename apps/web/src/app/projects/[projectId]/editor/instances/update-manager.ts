import { Setter } from 'jotai'
import { debounce } from 'lodash-es'

import { selectorWithForceUpdate } from '../utils/selector-with-force-update'

import { registerUpdateManager, UpdateListener } from './base'
import { TrackDel } from './common'

export class UpdateManager {
  private static instance: UpdateManager
  instancesMap: Partial<Record<string, ReturnType<typeof selectorWithForceUpdate>>> = {}

  setList = new Set<string>()

  setter?: Setter
  forceUpdate = debounce(async () => {
    await Promise.resolve()
    this.setList.forEach((key) => {
      this.setter && this.instancesMap[key]?.forceUpdate(this.setter)
    })
    this.setList.clear()
  }, 17)

  static getInstance() {
    if (!UpdateManager.instance) {
      UpdateManager.instance = new UpdateManager()
    }
    return UpdateManager.instance
  }

  addSetList(observable: UpdateListener) {
    let parent = observable
    while (parent.parent) {
      parent = parent.parent
    }

    if (parent instanceof TrackDel) {
      this.setList.add(parent.type)
      this.forceUpdate()
    }
  }

  flushSync() {
    this.forceUpdate.cancel()
    this.setList.forEach((key) => {
      this.setter && this.instancesMap[key]?.forceUpdate(this.setter)
    })
    this.setList.clear()
  }

  init(
    setter: Setter,
    instancesMap: Partial<Record<string, ReturnType<typeof selectorWithForceUpdate>>>,
  ) {
    this.setter = setter
    this.instancesMap = instancesMap
  }
}

registerUpdateManager(UpdateManager.getInstance())
