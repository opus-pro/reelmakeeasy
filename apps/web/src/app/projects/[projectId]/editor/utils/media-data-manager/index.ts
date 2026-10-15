import { createMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import { MediaDataManager } from './manager'

export { FULL_RANGE_END, FULL_RANGE_START } from './constants'
export { MediaDataManager } from './manager'

/**
 * Resolves the MediaDataManager for a given dataManagerName, memoized by name.
 *
 * The data manager is a URL-keyed cache/fetch service that holds no per-engine
 * state, so engines working on the same media share one to dedupe downloads -
 * that is why the default 'mediaDataManager' returns the existing singleton.
 * Pass a distinct name only when an instance needs its own clearCache/reset
 * lifecycle.
 */
export const getMediaDataManager = createMapFn((_name: string) => new MediaDataManager())

export default getMediaDataManager('mediaDataManager')
