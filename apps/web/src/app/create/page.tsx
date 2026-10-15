'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { DashboardV2Page } from '@/app/dashboard-v2/DashboardV2'
import { useInitialBreakpoint } from '@/util/browserUtils'

import CreateLoading from './loading'

export default function CreatePage() {
  const router = useRouter()
  const { isBelowMd, isResolved } = useInitialBreakpoint('md')

  useEffect(() => {
    if (isResolved && !isBelowMd) {
      router.replace('/home')
    }
  }, [isBelowMd, isResolved, router])

  if (!isResolved) {
    return <CreateLoading />
  }

  if (!isBelowMd) {
    return null
  }

  return <DashboardV2Page mode="create" />
}
