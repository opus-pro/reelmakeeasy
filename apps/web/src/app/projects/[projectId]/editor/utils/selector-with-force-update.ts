import { Atom, atom, Setter } from 'jotai'

export function selectorWithForceUpdate<Value, V>(
  baseAtom: ReturnType<typeof atom<Value>>,
  callback: (value: Value) => V,
) {
  const forceUpdateAtom = atom<number>(0)
  const anAtom = atom((get) => {
    // a atomic operation to force update the atom
    get(forceUpdateAtom)
    return callback(get(baseAtom))
  }) as Atom<V> & {
    forceUpdate: (set: Setter) => void
  }

  const forceUpdate = (set: Setter) => {
    set(forceUpdateAtom, (v) => v + 1)
  }

  anAtom.forceUpdate = forceUpdate

  return anAtom
}
