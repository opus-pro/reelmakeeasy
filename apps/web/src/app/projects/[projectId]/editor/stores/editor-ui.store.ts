import { AssetProgressPhase } from '@reelmakeeasy/common/media/types'
import { atom } from 'jotai'

const quality = 720

export const defaultCanvasSize = {
  width: quality,
  height: Math.trunc((quality * 16) / 9),
}

const canvasSize = atom<{ height: number; width: number }>(defaultCanvasSize)
canvasSize.debugLabel = 'editor.ui.canvasSize'

const canvasScale = atom(0.8)
canvasScale.debugLabel = 'editor.ui.canvasScale'

const selectedShotId = atom<null | string>(null)
selectedShotId.debugLabel = 'editor.ui.selectedShotId'

export type GeneratingShotInfo = { id: string; phase: AssetProgressPhase }

const generatingShotsAtom = atom<GeneratingShotInfo[]>([])
generatingShotsAtom.debugLabel = 'editor.ui.generatingShots'

export const editorUiStore = {
  canvasSize,
  canvasScale,
  selectedShotId,
  generatingShots: generatingShotsAtom,
}
