import * as React from 'react'

/** Props of {@link TransparentImage}: the attributes of an `<img>`. */
export type TransparentImageProps = React.ImgHTMLAttributes<HTMLImageElement>

// A grey checkerboard, so the see-through parts of an image read as see-through.
const CHECKER_SQUARE = '#6b6b6b'
const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: '#909090',
  backgroundImage: [
    `linear-gradient(45deg, ${CHECKER_SQUARE} 25%, transparent 25%)`,
    `linear-gradient(-45deg, ${CHECKER_SQUARE} 25%, transparent 25%)`,
    `linear-gradient(45deg, transparent 75%, ${CHECKER_SQUARE} 75%)`,
    `linear-gradient(-45deg, transparent 75%, ${CHECKER_SQUARE} 75%)`,
  ].join(', '),
  backgroundSize: '14px 14px',
}

/**
 * `<img>` drawn over a checkerboard, for images that may have transparent areas. A `style` you
 * pass is applied on top of the checkerboard.
 *
 * @example
 * <TransparentImage alt="logo" src="/logo.png" />
 */
const TransparentImage = React.forwardRef<HTMLImageElement, TransparentImageProps>(
  ({ alt, src, style, ...props }, ref) => (
    <img alt={alt} ref={ref} {...props} src={src} style={{ ...CHECKERBOARD, ...style }} />
  ),
)
TransparentImage.displayName = 'TransparentImage'

export { TransparentImage }
