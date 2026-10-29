/**
 * The light purple ring on a picked tile, drawn inside the tile's own box (over its edge), so a
 * scrolling row or a neighbour's margin never cuts it off. Its parent needs `relative` and the
 * tile's corner radius (`rounded-lg`).
 */
export function SelectedRing() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-lg border-2 border-violet-300 shadow-[inset_0_0_10px_rgb(167_139_250/0.35)]"
    />
  )
}
