import { getRenderEngineStore } from './render-engine.store'

// The main editor's single engine is just the 'Module' instance of the shared
// factory. Keeping this export means the ~32 existing consumers stay unchanged
// while the per-instance store becomes the single source of truth.
export const renderMainEngineStore = getRenderEngineStore('Module')
