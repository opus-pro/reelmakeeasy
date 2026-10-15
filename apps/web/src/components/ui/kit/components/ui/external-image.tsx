import { forwardRef, type ImgHTMLAttributes } from 'react'

export type ExternalImageProps = ImgHTMLAttributes<HTMLImageElement>

/**
 * Drop-in <img> for cross-origin URLs (scraped assets, third-party CDNs).
 * Defaults crossOrigin="anonymous" and referrerPolicy="no-referrer" so the
 * element works under COEP and bypasses hotlink protection. Override either
 * prop to opt out of a specific default.
 *
 * @example
 * <ExternalImage src="https://cdn.example.com/a.png" alt="a" />
 */
const ExternalImage = forwardRef<HTMLImageElement, ExternalImageProps>(
  ({ crossOrigin = 'anonymous', referrerPolicy = 'no-referrer', ...props }, ref) => (
    <img crossOrigin={crossOrigin} ref={ref} referrerPolicy={referrerPolicy} {...props} />
  ),
)
ExternalImage.displayName = 'ExternalImage'

export { ExternalImage }
