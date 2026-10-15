'use client'

import { Toaster } from '@shared/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { ThemeProvider } from 'next-themes'
import { type ReactNode, Suspense, useEffect } from 'react'

import { isGlobalFloatingNotificationSlotHiddenAtom } from '@/atom/ui'
import { BfcacheReloadGuard } from '@/components/BfcacheReloadGuard'
import { OngoingProjectsNotification } from '@/components/ongoing-projects/OngoingProjectsNotification'
import { VisualViewportSync } from '@/components/VisualViewportSync'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { capturePersistedUrlQueryParams } from '@/util/persisted-url-query-params'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      networkMode: 'offlineFirst',
    },
  },
})

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Immediate capture: grabs allowlisted URL query params before navigation
    capturePersistedUrlQueryParams()
  }, [])

  return (
    // font family provider: https://www.npmjs.com/package/geist?activeTab=readme
    // A plain wrapper: each page marks its own content as <main>, and there is only one.
    <div className="font-sans">
      <QueryClientProvider client={queryClient}>
        {/* The provider tree reads search params; render it client-side only. */}
        <Suspense fallback={null}>
          <ProjectProvider>
            <ThemeProviderWrapper>
              <BfcacheReloadGuard />
              <VisualViewportSync />
              <GlobalFloatingBlocks />
              <Suspense fallback={null}>{children}</Suspense>
              <Toaster />
            </ThemeProviderWrapper>
          </ProjectProvider>
        </Suspense>
      </QueryClientProvider>
    </div>
  )
}

function GlobalFloatingBlocks() {
  const isSlotHidden = useAtomValue(isGlobalFloatingNotificationSlotHiddenAtom)

  return (
    <div
      className="max-md:hidden fixed right-6 top-6 z-[65] flex flex-row items-start gap-2"
      data-global-floating-blocks
    >
      <OngoingProjectsNotification visible={!isSlotHidden} />
      {/* Add more floating blocks here. */}
    </div>
  )
}

// next-themes injects its anti-FOUC theme script via React.createElement('script', ...).
// React 19 (pulled in by Next 16) warns "Encountered a script tag while rendering React
// component" for any <script> rendered inside a component. The script still runs correctly
// during SSR, so for this case the warning is a false positive. next-themes is unmaintained
// (no releases since Mar 2025), so there is no upstream fix; we drop only this one message,
// only in development. See:
//   https://github.com/pacocoursey/next-themes/issues/385
//   https://github.com/shadcn-ui/ui/issues/10104
// The guard makes this idempotent: this module re-evaluates on Fast Refresh, and without it
// each re-run would wrap the already-wrapped console.error into a growing chain.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const c = console as Console & { __nextThemesScriptWarningPatched?: boolean }
  if (!c.__nextThemesScriptWarningPatched) {
    c.__nextThemesScriptWarningPatched = true
    const originalError = c.error
    c.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('Encountered a script tag')) {
        return
      }
      originalError.apply(c, args)
    }
  }
}

function ThemeProviderWrapper({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="ui"
      disableTransitionOnChange
      enableSystem={false}
      forcedTheme="ui"
    >
      {children}
    </ThemeProvider>
  )
}
