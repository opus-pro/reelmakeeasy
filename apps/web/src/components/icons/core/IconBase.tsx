import * as React from 'react'

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Sets both width and height together. Overridden by explicit width/height props. */
  size?: number | string
  /**
   * Tints the icon by setting CSS `color`. Works for both fill-based and stroke-based
   * icons because both use `currentColor`, which reads the CSS color property.
   * Overridden by an explicit style.color in the same props.
   */
  color?: string
}

/**
 * Resolves IconProps into plain SVGProps for spreading onto the <svg> element.
 * Extracts size/color before the spread so they don't reach the DOM as unknown attrs.
 */
export function iconSvgProps({
  size,
  color,
  style,
  width,
  height,
  ...rest
}: IconProps): React.SVGProps<SVGSVGElement> {
  return {
    width: width ?? size,
    height: height ?? size,
    style: color != null ? { color, ...style } : style,
    ...rest,
  }
}
