import { join } from 'node:path'

import type { Config } from 'tailwindcss'

import preset from './tailwind.preset'

const config: Config = {
  presets: [preset],
  content: [
    join(__dirname, 'src/**/*.{js,ts,jsx,tsx,mdx}'),
    join(__dirname, '../ui/stories/**/*.{js,ts,jsx,tsx,mdx}'),
  ],
}

export default config
