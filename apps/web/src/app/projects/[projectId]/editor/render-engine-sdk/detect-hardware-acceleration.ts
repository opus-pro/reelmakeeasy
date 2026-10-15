export interface HardwareAccelerationStatus {
  renderer: null | string
  supported: boolean
}

// Probes a throwaway canvas, independent of the engine's own #render-canvas, so
// it can run before the WASM module loads -- catching the case where av-engine's
// OpusFBO::InitializeGL would otherwise crash on an undefined GL context.
// Only a fully-missing context counts as unsupported; a working software-rendered
// context (SwiftShader, llvmpipe, etc.) is left as supported since we haven't
// measured whether this engine is actually unusable under software rendering --
// measure that first before adding a renderer-string check here.
export function detectHardwareAcceleration(): HardwareAccelerationStatus {
  const canvas = document.createElement('canvas')
  const gl = (canvas.getContext('webgl2') ??
    canvas.getContext('webgl')) as null | WebGLRenderingContext

  if (!gl) {
    return { supported: false, renderer: null }
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debugInfo ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) : null

  return { supported: true, renderer }
}
