import { API_ORIGIN } from '@reelmakeeasy/common/constant/domain'

/**
 * Home-scoped layout. Its only job (besides rendering children) is to emit a
 * preconnect hint for the API origin, which serves the /api/demo-projects fetch
 * that gates the Story Mode showcase and the demo media from the preset pack.
 * The app sends no cookies, so an anonymous connection matches what it opens.
 * React 19 hoists these <link> elements into <head>, and layouts render above
 * page content so the hints land before the gallery's fetches start.
 */
const API_HOST = process.env.NEXT_PUBLIC_API_ORIGIN || API_ORIGIN.LOCAL

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link crossOrigin="anonymous" href={API_HOST} rel="preconnect" />
      <link href={API_HOST} rel="dns-prefetch" />
      {children}
    </>
  )
}
