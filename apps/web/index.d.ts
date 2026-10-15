declare module '*.svg' {
  import * as React from 'react'

  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement> & { title?: string }>

  export default ReactComponent
}

declare module '*.svg?url' {
  const content: string
  export default content
}

// Rive animations imported as a bundler-resolved URL (asset/resource in next.config webpack).
declare module '*.riv' {
  const src: string
  export default src
}

// Next.js declares raster image modules via the generated next-env.d.ts, which
// may be absent before a build. Declare .webp here so static .webp imports
// type-check without one.
declare module '*.webp' {
  import type { StaticImageData } from 'next/image'

  const content: StaticImageData
  export default content
}
