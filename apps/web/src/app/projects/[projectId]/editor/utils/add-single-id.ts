import { genNanoId } from '@reelmakeeasy/common/utils/gen-nano-id'

export function addSingleId(prefix: string): string {
  return `${prefix}-${genNanoId(6)}`
}
