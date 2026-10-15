import { usePathname, useSearchParams } from 'next/navigation'

import { useRefCallback } from './use-ref-callback'

export function useQueryParams() {
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const get = (key: string) => searchParams?.get(key) ?? ''

  const set = (key: string, value: null | string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')

    if (value === null) {
      params.delete(key)
    } else {
      params.set(key, value)
    }

    // use history.pushState to avoid adding a new history entry
    // router.push(`${pathname}?${params.toString()}`)
    window.history.pushState(null, '', `${pathname}?${params.toString()}`)
  }

  return { get, set, all: searchParams }
}
export function useQueryParamsByKey<T = string>(key: string, defaultValue: T = '' as T) {
  const params = useQueryParams()
  const set = useRefCallback((t: T) => {
    params.set(key, t as string)
  })
  return [(params.get(key) ?? defaultValue) as T, set] as const
}
