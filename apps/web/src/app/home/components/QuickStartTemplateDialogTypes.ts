import type { PrimitiveAtom } from 'jotai'

export type QuickStartVideoMetadata = {
  duration: number
  ratioLabel?: '1:1' | '9:16' | '16:9'
  status: 'error' | 'pending' | 'ready'
}

export type QuickStartVideoMetadataAtom = PrimitiveAtom<QuickStartVideoMetadataMap>
export type QuickStartVideoMetadataMap = ReadonlyMap<string, QuickStartVideoMetadata>
