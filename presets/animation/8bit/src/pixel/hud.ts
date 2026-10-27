// @ts-nocheck -- ported as it is from the pixel-lesson kit (plain JS)
// The pixel HUD on a 1080×1920 canvas: hook box, captions, counters, gauges, bars, traces, stamps.
// Sizes snap to the 4 px grid of the 3D pixels so text and scene share one pixel grid.
import { drawText, textWidth, GLYPH_H } from './font'
const S = (v) => Math.round(v / 4) * 4
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const back = (x) => { const c = 1.7; x = clamp(x); return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2 }

export const COLORS = { ink: '#F4F1E6', yellow: '#FFD84A', cyan: '#6FE3FF', red: '#FF5A5A', green: '#7BFF9A', dim: '#8C94C8', panel: 'rgba(9,12,32,0.86)', line: '#B8C2FF', orange: '#FFA640' }

export function makeHud(canvas) {
  const g = canvas.getContext('2d')
  g.imageSmoothingEnabled = false
  const H = {
    g, C: COLORS,
    clear() { g.clearRect(0, 0, canvas.width, canvas.height) },
    text(s, x, y, { u = 4, color = COLORS.ink, align = 'left', shadow = true } = {}) {
      const w = textWidth(s, u), x0 = S(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x)
      if (shadow) drawText(g, s, x0 + u, S(y) + u, u, 'rgba(0,0,0,0.55)')
      drawText(g, s, x0, S(y), u, color)
      return w
    },
    panel(x, y, w, h, { fill = COLORS.panel, border = COLORS.line, u = 4 } = {}) {
      x = S(x); y = S(y); w = S(w); h = S(h)
      g.fillStyle = fill; g.fillRect(x, y, w, h)
      g.fillStyle = border
      g.fillRect(x, y, w, u); g.fillRect(x, y + h - u, w, u); g.fillRect(x, y, u, h); g.fillRect(x + w - u, y, u, h)
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + u, y + h, w, u); g.fillRect(x + w, y + u, u, h)
    },
    // The question box: lines typed out from t0 (about 28 characters a second).
    hook(lines, t, t0, { y = 236, u = 5, out = Infinity } = {}) {
      if (t < t0 || t > out + 0.25) return
      const k = t > out ? 1 - (t - out) / 0.25 : 1
      const maxW = Math.max(...lines.map((l) => textWidth(l.text, u)))
      const w = maxW + 15 * u, h = lines.length * (GLYPH_H + 5) * u + 9 * u
      g.globalAlpha = k
      H.panel(540 - w / 2, y, w, h)
      let shown = Math.floor((t - t0) * 28)
      lines.forEach((l, i) => {
        const s = l.text.slice(0, Math.max(0, shown)); shown -= l.text.length + 3
        const x0 = S(540 - textWidth(l.text, u) / 2)
        H.text(s, x0, y + 6 * u + i * (GLYPH_H + 5) * u, { u, color: l.color || COLORS.ink })
        if (shown < 0 && shown > -l.text.length - 3 && Math.floor(t * 4) % 2 === 0 && s.length < l.text.length)
          g.fillRect(x0 + textWidth(s, u) + u, y + 6 * u + i * (GLYPH_H + 5) * u, u * 4, GLYPH_H * u)
      })
      g.globalAlpha = 1
    },
    // A small caption in a box; pops in at t0, out at t1.
    caption(s, t, t0, t1, { y = 1580, color = COLORS.ink, u = 4, box = true } = {}) {
      if (t < t0 || t > t1) return
      const k = back((t - t0) / 0.18), o = clamp((t1 - t) / 0.15)
      const w = textWidth(s, u) + 12 * u, h = (GLYPH_H + 8) * u
      g.globalAlpha = o
      if (box) H.panel(540 - (w * k) / 2, y, w * k, h)
      if (k > 0.85) H.text(s, 540, y + 4 * u, { u, color, align: 'center' })
      g.globalAlpha = 1
    },
    // A big word that slams in (u = cell size), shaking for a moment.
    stamp(s, t, t0, t1, { y = 820, color = COLORS.yellow, u = 14, shake = 1 } = {}) {
      if (t < t0 || t > t1) return
      const p = (t - t0) / 0.22, k = p < 1 ? 1.6 - 0.6 * back(p) : 1
      const sh = Math.max(0, 1 - (t - t0) / 0.35) * 12 * shake
      const uu = Math.max(2, Math.round(u * k))
      g.globalAlpha = clamp((t1 - t) / 0.15)
      H.text(s, 540 + Math.sin(t * 90) * sh, y - ((GLYPH_H * uu) / 2) + Math.cos(t * 77) * sh, { u: uu, color, align: 'center' })
      g.globalAlpha = 1
    },
    // A labelled number: label above, value below.
    counter(label, value, x, y, w, { color = COLORS.ink, u = 6, sub, align = 'center' } = {}) {
      const h = (GLYPH_H * u) + 13 * 4 + (sub ? 8 * 4 : 0)
      H.panel(x, y, w, h)
      H.text(label, x + w / 2, y + 12, { u: 3, color: COLORS.dim, align: 'center', shadow: false })
      H.text(value, align === 'center' ? x + w / 2 : x + w - 20, y + 44, { u, color, align })
      if (sub) H.text(sub, x + w / 2, y + 44 + GLYPH_H * u + 12, { u: 3, color: COLORS.dim, align: 'center', shadow: false })
    },
    // Horizontal bar 0..1.
    bar(x, y, w, h, frac, { color = COLORS.cyan, back: bg = 'rgba(255,255,255,0.12)', ticks = 10 } = {}) {
      x = S(x); y = S(y); w = S(w); h = S(h)
      g.fillStyle = bg; g.fillRect(x, y, w, h)
      g.fillStyle = color; g.fillRect(x, y, S(w * clamp(frac)), h)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      for (let i = 1; i < ticks; i++) g.fillRect(x + S((w * i) / ticks), y, 4, h)
    },
    // A semicircle gauge of blocks, value 0..1.
    gauge(cx, cy, r, v, { color = COLORS.yellow, label, sub, n = 24 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1)) * Math.PI, on = i / (n - 1) <= v + 1e-6
        g.fillStyle = on ? color : 'rgba(255,255,255,0.14)'
        g.fillRect(S(cx + Math.cos(a) * r) - 6, S(cy + Math.sin(a) * r) - 6, 12, 12)
      }
      const a = Math.PI + clamp(v) * Math.PI
      for (let k = 0; k < r * 0.8; k += 4) { g.fillStyle = COLORS.ink; g.fillRect(S(cx + Math.cos(a) * k), S(cy + Math.sin(a) * k), 4, 4) }
      if (label) H.text(label, cx, cy + 20, { u: 5, color, align: 'center' })
      if (sub) H.text(sub, cx, cy + 64, { u: 3, color: COLORS.dim, align: 'center' })
    },
    // An oscilloscope trace of f(x in 0..1) -> -1..1, drawn in 4 px steps.
    trace(x, y, w, h, f, { color = COLORS.cyan, thick = 4, frame = true } = {}) {
      if (frame) H.panel(x - 8, y - 8, w + 16, h + 16, { fill: 'rgba(9,12,32,0.7)', border: 'rgba(184,194,255,0.5)' })
      g.fillStyle = 'rgba(184,194,255,0.18)'; g.fillRect(S(x), S(y + h / 2), S(w), 4)
      g.fillStyle = color
      let prev = null
      for (let i = 0; i <= w; i += 4) {
        const v = clamp(f(i / w), -1, 1), yy = S(y + h / 2 - (v * h) / 2)
        const y0 = prev === null ? yy : Math.min(prev, yy), y1 = prev === null ? yy : Math.max(prev, yy)
        g.fillRect(S(x + i), y0, thick, Math.max(thick, y1 - y0 + thick)); prev = yy
      }
    },
    // A colour legend strip with end labels.
    legend(x, y, w, colors, left, right) {
      const n = colors.length
      colors.forEach((c, i) => { g.fillStyle = c; g.fillRect(S(x + (i * w) / n), S(y), S(w / n) + 4, 16) })
      H.text(left, x, y + 24, { u: 3, color: COLORS.dim, shadow: false })
      H.text(right, x + w, y + 24, { u: 3, color: COLORS.dim, align: 'right', shadow: false })
    },
    // A free polyline in screen space, drawn as 4 px blocks (pixel-crisp waves over the 3D scene).
    poly(pts, color, thick = 4) {
      g.fillStyle = color
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4))
        for (let i = 0; i <= n; i++) g.fillRect(S(x0 + ((x1 - x0) * i) / n) - thick / 2, S(y0 + ((y1 - y0) * i) / n) - thick / 2, thick, thick)
      }
    },
    // A label tied to a screen point by a dotted leader line (from toScreen of a 3D point).
    tag(s, [px, py], [ox, oy], { color = COLORS.ink, u = 3, k = 1 } = {}) {
      if (k <= 0.01) return
      const tx = px + ox, ty = py + oy, n = Math.floor(Math.hypot(ox, oy) / 10 * clamp(k * 1.5))
      g.fillStyle = color
      for (let i = 0; i < n; i++) { const f = i / Math.max(1, Math.hypot(ox, oy) / 10); g.fillRect(S(px + ox * f), S(py + oy * f), 4, 4) }
      g.fillRect(S(px) - 4, S(py) - 4, 8, 8)
      if (k > 0.6) { const w = textWidth(s, u); const x0 = ox < 0 ? tx - w - 6 : tx + 6; g.fillStyle = 'rgba(9,12,32,0.8)'; g.fillRect(S(x0) - 6, S(ty - GLYPH_H * u / 2) - 6, S(w) + 12, GLYPH_H * u + 12); H.text(s, x0, ty - GLYPH_H * u / 2, { u, color, shadow: false }) }
    },
    // The dashed ring around the x-ray lens (cx, cy, r in px).
    ring(cx, cy, r, { color = 'rgba(220,232,255,0.85)', dash = 10 } = {}) {
      const n = Math.floor((2 * Math.PI * r) / 12)
      g.fillStyle = color
      for (let i = 0; i < n; i++) if (Math.floor(i / 2) % 2 === 0 || dash === 0) { const a = (i / n) * Math.PI * 2; g.fillRect(S(cx + Math.cos(a) * r) - 2, S(cy + Math.sin(a) * r) - 2, 4, 4) }
    },
    // A scrolling heart-monitor style trace: f(time) sampled across the width.
    scope(x, y, w, h, f, t, { color = COLORS.green, span = 3 } = {}) {
      H.panel(x - 8, y - 8, w + 16, h + 16, { fill: 'rgba(9,12,32,0.75)', border: 'rgba(184,194,255,0.45)' })
      H.trace(x, y, w, h, (u) => f(t - span + u * span), { color, frame: false })
    },
    watermark(s) { H.text(s, 540, 1868, { u: 3, color: 'rgba(244,241,230,0.45)', align: 'center', shadow: false }) },
  }
  return H
}
export const fmt = (n) => Math.round(n).toLocaleString('en-US')
