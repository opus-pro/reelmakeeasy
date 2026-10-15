// 2MB
const chunkSize = 2 * 1024 * 1024
type DataInterval = Interval & {
  data: ArrayBuffer
}
type Interval = {
  end: number
  start: number
}
// calculate the difference set of intervals
export function intervalDifference(mainInterval: Interval, intervals: Interval[]): Interval[] {
  const result: Interval[] = []
  let currentStart = mainInterval.start
  const currentEnd = mainInterval.end

  for (const interval of intervals.toSorted((a, b) => a.start - b.start || a.end - b.end)) {
    if (interval.end <= currentStart || interval.start >= currentEnd) {
      // if the current interval does not overlap with mainInterval
      continue
    }
    if (interval.start > currentStart) {
      // add non-overlapping parts.
      result.push({ start: currentStart, end: interval.start })
    }
    // update currentStart
    currentStart = Math.max(currentStart, interval.end)
  }

  // add the last non-overlapping part
  if (currentStart < currentEnd) {
    result.push({ start: currentStart, end: currentEnd })
  }

  return result
}
export function mergeIntervalsWithData(
  mainInterval: DataInterval,
  intervals: DataInterval[],
): DataInterval[] {
  const allIntervals = [...intervals, mainInterval]

  allIntervals.sort((a, b) => a.start - b.start || a.end - b.end)

  const result: DataInterval[] = []
  let currentInterval = allIntervals[0]

  for (let i = 1; i < allIntervals.length; i++) {
    const interval = allIntervals[i]

    if (currentInterval.end >= interval.start) {
      // overlap and merge the interval
      const newEnd = Math.max(currentInterval.end, interval.end)
      const newLength = newEnd - currentInterval.start + 1

      // create a new ArrayBuffer and merge the data
      const newData = new ArrayBuffer(newLength)
      const newDataView = new Uint8Array(newData)
      const currentDataView = new Uint8Array(currentInterval.data)
      const intervalDataView = new Uint8Array(interval.data)

      // copy the data of currentInterval
      const currentDataLength = Math.min(currentDataView.length, newLength)
      newDataView.set(currentDataView.subarray(0, currentDataLength), 0)

      // copy the data of interval
      const startOffset = interval.start - currentInterval.start
      const intervalDataStart = Math.max(0, startOffset)
      const intervalDataLength = Math.min(intervalDataView.length, newLength - intervalDataStart)
      newDataView.set(intervalDataView.subarray(0, intervalDataLength), intervalDataStart)

      currentInterval = {
        start: currentInterval.start,
        end: newEnd,
        data: newData,
      }
    } else {
      // no overlap, add the current interval to the result
      result.push(currentInterval)
      currentInterval = interval
    }
  }

  // add the last interval
  result.push(currentInterval)

  return result
}
export function splitInterval(interval: Interval) {
  const chunks = []
  for (let i = interval.start; i < interval.end; i += chunkSize) {
    const end = Math.min(i + chunkSize, interval.end)
    const chunk = {
      start: i,
      end,
    }
    chunks.push(chunk)
  }
  return chunks
}
