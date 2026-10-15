import pLimit from 'p-limit'

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(Math.max(1, Math.floor(concurrency)))
  return Promise.all(items.map((item, index) => limit(() => mapper(item, index))))
}

export async function mapWithConcurrencySettled<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const limit = pLimit(Math.max(1, Math.floor(concurrency)))
  return Promise.allSettled(items.map((item, index) => limit(() => mapper(item, index))))
}
