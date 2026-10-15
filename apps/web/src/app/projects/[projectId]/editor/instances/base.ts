abstract class Base {
  id: string
  constructor(id: string) {
    this.id = id
  }
}

let UpdateManager:
  | undefined
  | {
      addSetList: (instance: UpdateListener) => void
    } = undefined
export const registerUpdateManager = (manager: {
  addSetList: (instance: UpdateListener) => void
}): void => {
  if (UpdateManager) {
    return
  }
  UpdateManager = manager
}

export abstract class UpdateListener extends Base {
  parent?: UpdateListener
  constructor(id: string) {
    super(id)
    return new Proxy(this, {
      set: (target, property, value) => {
        Reflect.set(target, property, value)
        UpdateManager?.addSetList(this)
        return true
      },
      get: (target, property) => {
        return Reflect.get(target, property)
      },
    })
  }
}
