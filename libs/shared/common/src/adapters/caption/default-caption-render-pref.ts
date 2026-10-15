import type { CaptionRenderReference } from './caption-render-preference.zod'

/** The caption style used when a render has no caption preference of its own. */
export function getDefaultCaptionRenderPref() {
  const renderPref: CaptionRenderReference = {
    layoutAspectRatio: 'portrait',
    enableCaption: true,
    enableCaptionAnimation: true,
    captionAnimation: {
      name: 'word-level_karaoke_fill-pop',
      highlightColor: '#04f827',
    },
    lineCount: 1,
    captionPosition: 'bottom',
    enableHighlight: true,
    enableUppercase: true,
    highlightColor: {
      primary: '#04f827',
      secondary: '#FFFD03',
    },
    font: {
      size: 'Large',
      numericalSize: 35,
      color: '#ffffff',
      stroke: {
        enabled: true,
        color: '#000000',
        width: 8,
      },
      style: ['900'],
      textDecoration: '',
      family: 'Montserrat',
      shadow: {
        enabled: true,
        color: '#000000',
        x: 2,
        y: 2,
        blur: 2,
      },
    },
  }
  return renderPref
}
