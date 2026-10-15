export class MinHeap<T> {
  get length(): number {
    return this.heap.length
  }

  private compareFn: (a: T, b: T) => number
  private heap: T[] = []

  constructor(compareFn: (a: T, b: T) => number) {
    this.compareFn = compareFn
  }

  clear(): void {
    this.heap = []
  }

  peek(): T | undefined {
    return this.heap[0]
  }

  pop(): T | undefined {
    if (this.heap.length === 0) {
      return undefined
    }
    if (this.heap.length === 1) {
      return this.heap.pop()
    }

    const result = this.heap[0]
    const last = this.heap.pop()
    if (last !== undefined && this.heap.length > 0) {
      this.heap[0] = last
      this.siftDown(0)
    }
    return result
  }

  push(item: T): void {
    this.heap.push(item)
    this.siftUp(this.heap.length - 1)
  }

  toArray(): T[] {
    return [...this.heap]
  }

  private siftDown(index: number): void {
    const length = this.heap.length
    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (leftChild < length && this.compareFn(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild
      }
      if (rightChild < length && this.compareFn(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild
      }
      if (smallest === index) {
        break
      }
      ;[this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]]
      index = smallest
    }
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.compareFn(this.heap[index], this.heap[parent]) >= 0) {
        break
      }
      ;[this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]]
      index = parent
    }
  }
}
