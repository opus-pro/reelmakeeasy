import { z } from 'zod'

import { DataResponse } from '../common/api'
import { Project } from '../project'

import { AccessLevel } from './access-level.enum'

export { AccessLevel } from './access-level.enum'

export type SharedProjectFull = Project & {
  sharedProjectId: string
}
export type SharedProjectFullResponse = DataResponse<SharedProjectFull>

export const CreateSharedProjectBody = z.object({
  projectId: z.string(),
})

export type CreateSharedProjectBodyType = z.infer<typeof CreateSharedProjectBody>
export type CreateSharedProjectResponse = DataResponse<{
  sharedProjectId: string
}>

const SharedProject = z.object({
  projectId: z.string(),
  sharedProjectId: z.string(),
  disabled: z.boolean(),
  owner: z.string(),
  accessLevel: z.enum([AccessLevel.PUBLIC, AccessLevel.PRIVATE]),
})

export type SharedProject = z.infer<typeof SharedProject>
export type SharedProjectResponse = DataResponse<SharedProject>

export const SearchByProjectIdBody = z.object({
  projectId: z.string(),
})

export type SearchByProjectIdBodyType = z.infer<typeof SearchByProjectIdBody>
export type SearchByProjectIdResponse = DataResponse<SharedProject>

export const UpdateAccessLevelBody = z.object({
  accessLevel: z.enum([AccessLevel.PUBLIC, AccessLevel.PRIVATE]),
})

export type UpdateAccessLevelBodyType = z.infer<typeof UpdateAccessLevelBody>
