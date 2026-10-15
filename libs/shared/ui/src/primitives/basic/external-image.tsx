import * as React from 'react'

/** Props of {@link ExternalImage}: the attributes of an `<img>`. */
export type ExternalImageProps = React.ImgHTMLAttributes<HTMLImageElement>

/**
 * `<img>` for images on other sites (CDNs, scraped pages). It loads them anonymously and sends no
 * referrer, so it works on a cross-origin-isolated page and gets past hotlink checks. Pass
 * `crossOrigin` or `referrerPolicy` to change either default.
 *
 * @example
 * <ExternalImage alt="cover" src="https://cdn.example.com/a.png" />
 */
const ExternalImage = React.forwardRef<HTMLImageElement, ExternalImageProps>((props, ref) => (
  <img crossOrigin="anonymous" ref={ref} referrerPolicy="no-referrer" {...props} />
))
ExternalImage.displayName = 'ExternalImage'

export { ExternalImage }
