// @ts-nocheck -- ported as it is from the pixel-lesson kit (plain JS)
// Pixel engine: three.js renders the 3D scene into a 270×480 target, a post pass adds a blocky glow,
// a flash, a vignette and ordered (Bayer) dithering, and the page scales that 4× with hard pixel edges.
// A 1080×1920 2D canvas on top carries the pixel-font HUD. Everything is a function of time t.
import * as THREE from 'three'
import { makeHud } from './hud'
export { THREE }
export let LO_W = 270, LO_H = 480

export function createEngine({ res = 270, gl: cv, hud: hudCanvas } = {}) {
  LO_W = res; LO_H = Math.round((res * 16) / 9)
  cv.width = LO_W; cv.height = LO_H
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(LO_W, LO_H, false)
  const rt = new THREE.WebGLRenderTarget(LO_W, LO_H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType })
  const rtX = new THREE.WebGLRenderTarget(LO_W, LO_H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType })
  const scene = new THREE.Scene()
  // The x-ray lens: objects on layer 1 are the "inside". They render to a second target, shown only inside a
  // circle (lens.x, lens.y in 0..1 screen space, lens.r as a fraction of the screen width).
  const lens = { on: false, x: 0.5, y: 0.5, r: 0.3, tint: new THREE.Color('#0A1030'), insideBg: new THREE.Color('#0B1230') }
  const camera = new THREE.PerspectiveCamera(40, LO_W / LO_H, 0.1, 4000)

  const post = { bloom: 1, threshold: 0.75, levels: 18, flash: 0, flashColor: new THREE.Color('#ffffff'), vignette: 0.35, scanline: 0.06 }
  const mat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: rt.texture }, tX: { value: rtX.texture }, lensOn: { value: 0 }, lensP: { value: new THREE.Vector3(0.5, 0.5, 0.3) },
      res: { value: new THREE.Vector2(LO_W, LO_H) }, bloom: { value: 1 }, threshold: { value: 0.75 },
      levels: { value: 18 }, flash: { value: 0 }, flashColor: { value: new THREE.Color() }, vignette: { value: 0.35 }, scanline: { value: 0.06 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `
      uniform sampler2D tScene, tX; uniform float lensOn; uniform vec3 lensP;
      uniform vec2 res; uniform float bloom, threshold, levels, flash, vignette, scanline; uniform vec3 flashColor;
      vec3 src(vec2 uv){
        if (lensOn > 0.5) { vec2 d = (uv - lensP.xy) * vec2(1.0, res.y / res.x); if (length(d) < lensP.z) return texture2D(tX, uv).rgb; }
        return texture2D(tScene, uv).rgb;
      }
      varying vec2 vUv;
      float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      void main(){
        vec2 px = 1.0 / res;
        vec3 c = src(vUv);
        vec3 b = vec3(0.0);                       // blocky glow: a small kernel over bright pixels, at pixel scale
        for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) {
          vec3 s = src(vUv + vec2(float(i), float(j)) * px);
          b += max(s - threshold, 0.0) * exp(-float(i * i + j * j) / 7.0);
        }
        c += b * bloom * 0.09;
        c = mix(c, flashColor, flash);
        vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
        vec2 d = vUv - 0.5; s *= 1.0 - vignette * dot(d, d) * 1.8;
        s *= 1.0 - scanline * step(1.0, mod(gl_FragCoord.y, 2.0));
        s = floor(s * levels + bayer4(gl_FragCoord.xy) ) / levels;  // ordered dither into "levels" steps
        gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  })
  const quadScene = new THREE.Scene()
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const hud = makeHud(hudCanvas)
  function render() {
    for (const k of ['bloom', 'threshold', 'levels', 'flash', 'vignette', 'scanline']) mat.uniforms[k].value = post[k]
    mat.uniforms.flashColor.value.copy(post.flashColor)
    mat.uniforms.lensOn.value = lens.on ? 1 : 0; mat.uniforms.lensP.value.set(lens.x, 1 - lens.y, lens.r)
    camera.layers.set(0); renderer.setRenderTarget(rt); renderer.render(scene, camera)
    if (lens.on) {
      const bg = scene.background, fog = scene.fog
      scene.background = lens.insideBg; scene.fog = null
      camera.layers.set(1); renderer.setRenderTarget(rtX); renderer.render(scene, camera)
      scene.background = bg; scene.fog = fog; camera.layers.set(0)
    }
    renderer.setRenderTarget(null); renderer.render(quadScene, quadCam)
  }
  // World point -> HUD pixel coordinates.
  const v = new THREE.Vector3()
  const toScreen = (p) => { v.copy(p).project(camera); return [(v.x + 1) * 540, (1 - v.y) * 960, v.z < 1] }
  // Bring every world matrix up to date (call after moving things, before toScreen / localToWorld).
  const sync = () => { scene.updateMatrixWorld(true); camera.updateMatrixWorld() }
  return { THREE, renderer, scene, camera, post, hud, render, toScreen, lens, sync, res: LO_W }
}

// ---------- shared helpers for episodes ----------
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, k) => a + (b - a) * k
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x) }
export const ss = (a, b, t) => smooth((t - a) / (b - a))
export const easeOut = (x) => 1 - (1 - clamp(x)) ** 3
export const back = (x) => { const c = 1.7; x = clamp(x); return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2 }
export const pulse = (t, at, len = 0.25) => (t >= at && t < at + len ? 1 - (t - at) / len : 0)
export const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
// Flat-shaded material; emissive above ~0.75 glows.
export const flat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...opts })
export const glow = (color, strength = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) })
// Moves an object and its children onto the x-ray layer (1), so it only shows inside the lens.
export function inside(obj) { obj.traverse((o) => o.layers.set(1)); return obj }
// Particles flowing along a curve: n instanced boxes, speed in curve-lengths per second, with a little jitter.
export function flow(curve, n, { size = 0.1, color = '#ff4a4a', speed = 0.2, jitter = 0.04, seed = 9, mat } = {}) {
  const r = rng(seed)
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), mat || new THREE.MeshBasicMaterial({ color }), n)
  const items = Array.from({ length: n }, () => ({ u: r(), j: new THREE.Vector3((r() - 0.5) * jitter, (r() - 0.5) * jitter, (r() - 0.5) * jitter), s: 0.8 + r() * 0.5, spin: r() * 6 }))
  const d = new THREE.Object3D(), p = new THREE.Vector3()
  m.update = (t, { rate = 1, visible = 1 } = {}) => {
    items.forEach((it, i) => {
      curve.getPointAt((((it.u + t * speed * rate * it.s) % 1) + 1) % 1, p)
      d.position.copy(p).add(it.j); d.rotation.set(it.spin + t, it.spin, 0); d.scale.setScalar(i / n < visible ? 1 : 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }
  return m
}
// A texture of lit windows (nearest-filtered so it stays pixel-crisp).
export function windowTexture(cols, rows, { lit = 0.5, on = '#FFD27A', off = '#1B2340', frame = '#0E1430', seed = 3, cell = 4 } = {}) {
  const r = rng(seed), c = document.createElement('canvas'); c.width = cols * cell; c.height = rows * cell
  const g = c.getContext('2d'); g.fillStyle = frame; g.fillRect(0, 0, c.width, c.height)
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { g.fillStyle = r() < lit ? on : off; g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2) }
  const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
