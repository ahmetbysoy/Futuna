export class BoundedQueue<T> implements Iterable<T> {
  private values: Array<T | undefined>
  private head = 0
  private count = 0

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Queue capacity must be a positive integer.')
    this.values = new Array<T | undefined>(capacity)
  }

  get length() {
    return this.count
  }

  push(value: T) {
    if (this.count < this.capacity) {
      this.values[(this.head + this.count) % this.capacity] = value
      this.count += 1
      return undefined
    }
    const evicted = this.values[this.head]
    this.values[this.head] = value
    this.head = (this.head + 1) % this.capacity
    return evicted
  }

  first() {
    return this.count > 0 ? this.values[this.head] : undefined
  }

  last() {
    return this.count > 0 ? this.values[(this.head + this.count - 1) % this.capacity] : undefined
  }

  dropFirst() {
    if (this.count === 0) return undefined
    const first = this.values[this.head]
    this.values[this.head] = undefined
    this.head = (this.head + 1) % this.capacity
    this.count -= 1
    return first
  }

  pruneWhile(predicate: (value: T) => boolean) {
    let removed = 0
    let first = this.first()
    while (first !== undefined && predicate(first)) {
      this.dropFirst()
      removed += 1
      first = this.first()
    }
    return removed
  }

  clear() {
    this.values.fill(undefined)
    this.head = 0
    this.count = 0
  }

  toArray() {
    return Array.from(this)
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let index = 0; index < this.count; index += 1) {
      const value = this.values[(this.head + index) % this.capacity]
      if (value !== undefined) yield value
    }
  }
}
