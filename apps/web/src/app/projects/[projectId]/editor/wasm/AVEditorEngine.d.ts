import { Engine } from './type'

declare module './AVEditorEngine' {
  const AVEditorEngine: (data: any) => Promise<Engine>
  export default AVEditorEngine
}

export {}
