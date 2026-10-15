import { Project } from '@shared/types/api/project'
import { atom } from 'jotai'

export type DeleteProjectDialogState = {
  open: boolean
  project: null | Project
}

export const deleteProjectDialogAtom = atom<DeleteProjectDialogState>({
  open: false,
  project: null,
})

deleteProjectDialogAtom.debugLabel = 'deleteProjectDialogAtom'
