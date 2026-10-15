import { useEffect } from 'react'

type UseBodyScrollLockOptions = {
  bodyOverflow?: string
  htmlOverflow?: string
  lockBody?: boolean
  lockHtml?: boolean
}

let bodyLockCount = 0
let htmlLockCount = 0
let previousBodyOverflow = ''
let previousHtmlOverflow = ''

export function useBodyScrollLock(
  locked: boolean,
  {
    bodyOverflow = 'hidden',
    htmlOverflow = 'hidden',
    lockBody = true,
    lockHtml = false,
  }: UseBodyScrollLockOptions = {},
) {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') {
      return
    }

    const body = document.body
    const html = document.documentElement

    if (lockBody) {
      if (bodyLockCount === 0) {
        previousBodyOverflow = body.style.overflow
      }
      bodyLockCount += 1
      body.style.overflow = bodyOverflow
    }

    if (lockHtml) {
      if (htmlLockCount === 0) {
        previousHtmlOverflow = html.style.overflow
      }
      htmlLockCount += 1
      html.style.overflow = htmlOverflow
    }

    return () => {
      if (lockBody) {
        bodyLockCount = Math.max(0, bodyLockCount - 1)
        if (bodyLockCount === 0) {
          body.style.overflow = previousBodyOverflow
        }
      }

      if (lockHtml) {
        htmlLockCount = Math.max(0, htmlLockCount - 1)
        if (htmlLockCount === 0) {
          html.style.overflow = previousHtmlOverflow
        }
      }
    }
  }, [locked, lockBody, lockHtml, bodyOverflow, htmlOverflow])
}
