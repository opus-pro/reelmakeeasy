'use client'

import { useEffect } from 'react'

import { SIDEBAR_V2_WIDTH } from '@/components/sidebar-config'
import SidebarV2 from '@/components/SidebarV2'

export default function AppSidebar() {
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${SIDEBAR_V2_WIDTH}px`)
  }, [])

  return <SidebarV2 />
}
