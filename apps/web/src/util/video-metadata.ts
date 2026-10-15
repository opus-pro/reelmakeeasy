export class VideoMetaLoader {
  onError?: (video: HTMLVideoElement) => void
  onLoadedMetadata?: (video: HTMLVideoElement) => void

  private disposed = false
  private readonly video: HTMLVideoElement

  constructor(url: string) {
    this.video = document.createElement('video')
    this.video.preload = 'metadata'
    this.video.tabIndex = -1
    this.video.setAttribute('aria-hidden', 'true')
    this.video.style.position = 'fixed'
    this.video.style.left = '0'
    this.video.style.top = '0'
    this.video.style.width = '0'
    this.video.style.height = '0'
    this.video.style.opacity = '0'
    this.video.style.pointerEvents = 'none'
    this.video.style.zIndex = '-1'

    this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.video.addEventListener('error', this.handleError)
    document.body.appendChild(this.video)
    this.video.src = url
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.video.removeEventListener('error', this.handleError)
    this.video.removeAttribute('src')
    this.video.load()
    this.video.remove()
  }

  private readonly handleError = () => {
    if (this.disposed) {
      return
    }
    this.onError?.(this.video)
    this.dispose()
  }

  private readonly handleLoadedMetadata = () => {
    if (this.disposed) {
      return
    }
    this.onLoadedMetadata?.(this.video)
    this.dispose()
  }
}
