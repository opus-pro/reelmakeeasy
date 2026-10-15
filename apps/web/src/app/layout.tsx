import type { Metadata } from 'next'

import { Providers } from './providers'

import './styles/tailwind.css'

const gitSha = process.env.NEXT_PUBLIC_GIT_SHA || 'unknown'

const DEFAULT_TITLE = 'ReelMakeEasy | AI Video Generator for Brands.'
const DEFAULT_DESCRIPTION =
  'ReelMakeEasy is an AI video generator that turns your scripts, voice, and brand assets into publish-ready videos, in one click. No prompting required.'

// Defaults for every route, expressed via the Metadata API (not literal <head>
// tags) so a page-level `metadata` export overrides them instead of shipping a
// second, conflicting title/og/twitter set (duplicate tags make scrapers pick
// arbitrarily).
export const metadata: Metadata = {
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    siteName: 'ReelMakeEasy',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  other: { 'x-build-git-sha': gitSha },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes writes the theme class onto <html> before hydration. The theme is
    // forced to "ui", so render it on the server too; suppressHydrationWarning is
    // what next-themes requires for the attributes it manages here.
    <html className="ui" lang="en" suppressHydrationWarning>
      <body style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
