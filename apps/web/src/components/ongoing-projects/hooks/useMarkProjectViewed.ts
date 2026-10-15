'use client'

import { Project } from '@shared/types/api/project'
import type { OrgProjectEventResource } from '@shared/types/sse/org-project-event'
import { useEffect } from 'react'

import { useApi } from '@/hooks/useApi'

import { isOngoingProject } from '../utils'

import { getProjectMarkQueue } from './MarkSeenPool'

type ProjectLike = Pick<Project, 'id' | 'stage'>

type ViewItem = {
  project: null | ProjectLike | undefined
  source: string
}

export function useMarkProjectViewed(items: ReadonlyArray<ViewItem>): void {
  const { fetchApiDomain } = useApi()

  useEffect(() => {
    const queues = {
      project: getProjectMarkQueue(fetchApiDomain),
    } satisfies Record<OrgProjectEventResource, unknown>

    const toMark = new Map<OrgProjectEventResource, Set<string>>()
    const toUnmark = new Map<OrgProjectEventResource, Set<string>>()

    for (const item of items) {
      if (!item.project || !(item.source in queues)) {
        continue
      }

      const projectId = item.project.id?.trim()
      if (!projectId) {
        continue
      }

      const resource = item.source as OrgProjectEventResource
      const target = isOngoingProject(item.project) ? toUnmark : toMark
      let batch = target.get(resource)
      if (!batch) {
        target.set(resource, (batch = new Set()))
      }
      batch.add(projectId)
    }

    for (const [resource, projectIds] of toUnmark) {
      queues[resource].unmark(projectIds)
    }
    for (const [resource, projectIds] of toMark) {
      void queues[resource].mark(projectIds)
    }
  }, [fetchApiDomain, items])
}
