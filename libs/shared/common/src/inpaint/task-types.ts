export type SerializedError = {
  readonly details?: null | readonly unknown[]
  readonly message: string
  readonly type?: null | string
}

export type TaskEntry<T, TArgs extends readonly unknown[] = readonly unknown[]> = {
  readonly args: Readonly<TArgs>
  readonly runs: readonly TaskRunRecord<T>[]
}

export type TaskRunRecord<T> =
  | TaskRunRecordCancelled
  | TaskRunRecordPending
  | TaskRunRecordRejected
  | TaskRunRecordResolved<T>

export type TaskRunRecordBase = {
  readonly id: string
  readonly startedAt: number
  readonly state: TaskRunRecordState
}

export type TaskRunRecordCancelled = TaskRunRecordBase & {
  readonly finishedAt: number
  readonly state: 'cancelled'
}

export type TaskRunRecordPending = TaskRunRecordBase & {
  readonly state: 'pending'
}

export type TaskRunRecordRejected = TaskRunRecordBase & {
  readonly error: SerializedError
  readonly finishedAt: number
  readonly state: 'rejected'
}

export type TaskRunRecordResolved<T> = TaskRunRecordBase & {
  readonly finishedAt: number
  readonly result: T
  readonly state: 'resolved'
}

export type TaskRunRecordState = 'cancelled' | 'pending' | 'rejected' | 'resolved'
