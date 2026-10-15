/** Admits `max` holders at a time, first come first served. */
export class Semaphore {
  private active = 0
  private readonly queue: (() => void)[] = []

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve))
    else this.active++
    try {
      return await fn()
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }
}
