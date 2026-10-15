export const DEFAULT_SEEDANCE_CONCURRENCY_LIMIT = 1000

// Happy Horse: a DashScope workspace enforces a HARD 5-concurrent
// cap, shared by every key in the workspace, and
// excess tasks queue vendor-side. The default mirrors the vendor cap so the
// gate keeps queueing on OUR side (visible in capacity metrics, bounded by
// withCapacity's wait timeout) instead of stacking invisibly at the vendor.
export const DEFAULT_HAPPY_HORSE_CONCURRENCY_LIMIT = 5
