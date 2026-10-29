/**
 * An SVG filter that cuts what it draws to a pixel grid of `block` units: each block takes the
 * colour at its centre, and colours are stepped. A pixel-art avatar is always drawn through it;
 * the Pixel art look's `PixelSprite` uses it too. `x`, `y`, `width`, `height`: the area it
 * covers, in the SVG's own units.
 */
/** A pixel-art avatar's grid, in its own box's units (1000 wide): about 8 screen pixels when it
 *  stands waist up in a 1080-wide frame. */
export const AVATAR_PIXEL = 9

export function pixelFilter(
  id: string,
  block: number,
  area: { height: number; width: number; x?: number; y?: number },
): string {
  const half = Math.max(1, Math.floor(block / 2))
  const steps = '0 0.2 0.4 0.6 0.8 1'
  return `<filter id="${id}" x="${area.x ?? 0}" y="${area.y ?? 0}" width="${area.width}" height="${area.height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood x="${half}" y="${half}" width="1" height="1"/><feComposite width="${block}" height="${block}"/><feTile result="grid"/><feComposite in="SourceGraphic" in2="grid" operator="in"/><feMorphology operator="dilate" radius="${half}"/><feComponentTransfer><feFuncR type="discrete" tableValues="${steps}"/><feFuncG type="discrete" tableValues="${steps}"/><feFuncB type="discrete" tableValues="${steps}"/><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter>`
}
