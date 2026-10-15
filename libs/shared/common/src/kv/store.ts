import fs from 'node:fs'
import path from 'node:path'

/**
 * In-process key-value store: strings, hashes, lists, sets and sorted sets with
 * per-key TTLs.
 *
 * ReelMakeEasy runs as one Node process, so shared state (locks, quotas, status
 * blobs, semaphores) lives here instead of in an external server. Every method is
 * synchronous: a sequence of calls with no `await` between them cannot interleave
 * with other work, so compound operations (compare-and-delete, check-then-write)
 * are atomic when written as plain synchronous code. Call sites that `await` a
 * method still work; awaiting a plain value is a no-op.
 *
 * Semantics follow the familiar data-structure-server model so the code built on
 * it reads the same:
 * - Stored values are strings. Objects are JSON-encoded on write; numbers and
 *   booleans are stringified. `getNumber` / `getObject` parse on read.
 * - `incr` / `incrBy` / `hIncrBy` treat a missing key or field as 0 and throw on
 *   a non-integer value.
 * - Using a key with an operation for another type throws `WRONGTYPE`.
 * - A collection whose last member is removed is deleted, TTL included.
 * - `set` clears an existing TTL unless one is given; other writes keep it.
 * - Expired keys are dropped lazily on access and by a periodic sweep.
 *
 * Persistence is opt-in per key prefix (see `KvStoreOptions.persistPrefixes`).
 * Matching keys are written to a JSON file (debounced, tmp + rename) and loaded
 * back on boot, skipping entries that expired while the process was down.
 */

export type KvValue = boolean | number | object | string

/** Bound for sorted-set range queries: a number, `-inf` / `+inf`, or `(n` for exclusive. */
export type KvScoreBound = number | string

export interface KvStoreOptions {
  /** JSON file for persisted keys. Omit for a purely in-memory store (tests). */
  file?: string
  /** Debounce for persisted writes, in ms. Default 200. */
  flushDelayMs?: number
  /** Keys starting with one of these prefixes are written to `file`. */
  persistPrefixes?: readonly string[]
  /** Interval of the expired-key sweep, in ms. Default 60s; 0 disables it. */
  sweepIntervalMs?: number
}

type Entry =
  | { expiresAt?: number; type: 'hash'; value: Map<string, string> }
  | { expiresAt?: number; type: 'list'; value: string[] }
  | { expiresAt?: number; type: 'set'; value: Set<string> }
  | { expiresAt?: number; type: 'string'; value: string }
  | { expiresAt?: number; type: 'zset'; value: Map<string, number> }

type EntryType = Entry['type']

type PersistedFile = { entries: Record<string, SerializedEntry>; version: 1 }

type SerializedEntry =
  | { expiresAt?: number; type: 'hash'; value: Record<string, string> }
  | { expiresAt?: number; type: 'list'; value: string[] }
  | { expiresAt?: number; type: 'set'; value: string[] }
  | { expiresAt?: number; type: 'string'; value: string }
  | { expiresAt?: number; type: 'zset'; value: Array<[string, number]> }

export class KvStore {
  private readonly data = new Map<string, Entry>()
  private readonly file?: string
  private readonly flushDelayMs: number
  private pendingFlush?: NodeJS.Timeout
  private readonly persistPrefixes: readonly string[]
  private sweepTimer?: NodeJS.Timeout

  constructor(opts: KvStoreOptions = {}) {
    this.file = opts.file
    this.flushDelayMs = opts.flushDelayMs ?? 200
    this.persistPrefixes = opts.persistPrefixes ?? []
    if (this.file) {
      this.load(this.file)
    }
    const sweepIntervalMs = opts.sweepIntervalMs ?? 60_000
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs)
      this.sweepTimer.unref()
    }
  }

  // ========== Lifecycle ==========

  /**
   * Take a slot in a counting semaphore, or return null at capacity.
   *
   * Slots are sorted-set members scored by their expiry, so a holder that never
   * releases (a crashed activity) frees its slot after `ttlMs`.
   */
  public acquireSemaphore(
    name: string,
    limit: number,
    ttlMs: number,
  ): null | { count: number; leaseId: string } {
    const key = `semaphore:${name}`
    const now = Date.now()
    this.zRemRangeByScore(key, '-inf', now)
    const count = this.zCard(key)
    if (count >= limit) {
      return null
    }
    const leaseId = `${now}:${Math.random().toString(36).slice(2, 9)}`
    this.zAdd(key, { score: now + ttlMs, value: leaseId })
    this.pExpire(key, ttlMs + 1000)
    return { leaseId, count: count + 1 }
  }

  /**
   * Record `value` in a sliding window keyed by `key`: prune entries older than the
   * window, add this one scored by now, and refresh the key's TTL.
   * @returns 1 when the member was new, 0 when it was already present
   */
  public addSlidingWindowValue(key: string, value: KvValue, windowSeconds: number): number {
    const ttlMs = (windowSeconds + 1) * 1000
    const now = Date.now()
    this.zRemRangeByScore(key, '-inf', now - ttlMs)
    const added = this.zAdd(key, { score: now, value })
    this.pExpire(key, ttlMs)
    return added
  }

  /** Stop the sweep timer and write any pending persisted changes. */
  public close(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = undefined
    }
    this.flush()
  }

  // ========== Keys ==========

  public del(key: string | string[]): number {
    let removed = 0
    for (const k of Array.isArray(key) ? key : [key]) {
      if (this.read(k)) {
        this.data.delete(k)
        this.touched(k)
        removed++
      }
    }
    return removed
  }

  public expire(key: string, ttlSeconds: number): boolean {
    return this.pExpire(key, ttlSeconds * 1000)
  }

  /** Write persisted keys now instead of waiting for the debounce. */
  public flush(): void {
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush)
      this.pendingFlush = undefined
    }
    if (!this.file) {
      return
    }
    const now = Date.now()
    const entries: Record<string, SerializedEntry> = {}
    for (const [key, entry] of this.data) {
      if (this.isPersisted(key) && !isExpired(entry, now)) {
        entries[key] = serializeEntry(entry)
      }
    }
    const payload: PersistedFile = { version: 1, entries }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload))
    fs.renameSync(tmp, this.file)
  }

  public get(key: string): null | string {
    const entry = this.read(key, 'string')
    return entry ? entry.value : null
  }

  public getNumber(key: string): null | number {
    const value = this.get(key)
    if (value === null) {
      return null
    }
    const num = Number(value)
    return Number.isNaN(num) ? null : num
  }

  // ========== Strings ==========

  public getObject<T = unknown>(key: string): null | T {
    const value = this.get(key)
    if (value === null) {
      return null
    }
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  /** Requests currently counted in a sliding-window limit. */
  public getRateLimitCount(name: string, windowMs: number): number {
    const key = rateLimitKey(name)
    this.zRemRangeByScore(key, '-inf', Date.now() - windowMs)
    return this.zCard(key)
  }

  public hGetAll(key: string): Record<string, string> {
    const entry = this.read(key, 'hash')
    return entry ? Object.fromEntries(entry.value) : {}
  }

  public hIncrBy(key: string, field: string, increment: number): number {
    const entry = this.readOrCreate(key, 'hash', () => new Map<string, string>())
    const next = parseInteger(entry.value.get(field) ?? '0') + Math.floor(increment)
    entry.value.set(field, String(next))
    this.touched(key)
    return next
  }

  /**
   * Set one field (`hSet(key, field, value)`) or several (`hSet(key, entries)`),
   * optionally (re)setting the hash's TTL.
   */
  public hSet(
    key: string,
    fieldOrEntries: Record<string, string> | string,
    value?: string,
    ttlSeconds?: number,
  ): void {
    if (typeof fieldOrEntries === 'string' && value === undefined) {
      throw new Error('hSet requires a value when fieldOrEntries is a string')
    }
    const entry = this.readOrCreate(key, 'hash', () => new Map<string, string>())
    const pairs =
      typeof fieldOrEntries === 'string'
        ? [[fieldOrEntries, value as string] as const]
        : Object.entries(fieldOrEntries)
    for (const [field, fieldValue] of pairs) {
      entry.value.set(field, fieldValue)
    }
    if (ttlSeconds) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000
    }
    this.touched(key)
  }

  public incr(key: string): number {
    return this.incrBy(key, 1)
  }

  public incrBy(key: string, increment: number): number {
    const entry = this.read(key, 'string')
    const next = parseInteger(entry?.value ?? '0') + Math.floor(increment)
    if (entry) {
      entry.value = String(next)
    } else {
      this.data.set(key, { type: 'string', value: String(next) })
    }
    this.touched(key)
    return next
  }

  public lLen(key: string): number {
    return this.read(key, 'list')?.value.length ?? 0
  }

  /** Elements `start..stop` inclusive; negative indices count from the end. */
  public lRange(key: string, start: number, stop: number): string[] {
    const list = this.read(key, 'list')?.value ?? []
    const [from, to] = resolveRange(list.length, start, stop)
    return list.slice(from, to)
  }

  // ========== Hashes ==========

  /** `lRange`, with each element JSON-parsed when possible. */
  public lRangeObjects<T = unknown>(key: string, start: number, stop: number): T[] {
    return this.lRange(key, start, stop).map((value) => parseLoose<T>(value))
  }

  public pExpire(key: string, ttlMs: number): boolean {
    const entry = this.read(key)
    if (!entry) {
      return false
    }
    if (ttlMs <= 0) {
      this.data.delete(key)
    } else {
      entry.expiresAt = Date.now() + ttlMs
    }
    this.touched(key)
    return true
  }

  /** Remaining TTL in ms; -2 when the key is missing, -1 when it has no TTL. */
  public pTTL(key: string): number {
    const entry = this.read(key)
    if (!entry) {
      return -2
    }
    if (entry.expiresAt === undefined) {
      return -1
    }
    return Math.max(0, entry.expiresAt - Date.now())
  }

  // ========== Lists ==========

  /**
   * Sliding-window rate limit: allow and record the request when fewer than
   * `maxRequests` were recorded in the last `windowMs`.
   * @param now explicit timestamp in ms (defaults to Date.now())
   * @param val value to record; defaults to the timestamp. Lets a caller refund it later.
   */
  public rateLimitSlidingWindow(
    name: string,
    maxRequests: number,
    windowMs: number,
    now?: number,
    val?: KvValue,
  ): boolean {
    const key = rateLimitKey(name)
    const at = now ?? Date.now()
    this.zRemRangeByScore(key, '-inf', at - windowMs)
    if (this.zCard(key) >= maxRequests) {
      return false
    }
    const member = val === undefined ? '' : serializeValue(val)
    this.zAdd(key, { score: at, value: member || String(at) })
    this.pExpire(key, windowMs + 1000)
    return true
  }

  /**
   * Refund sliding-window requests by recorded value, searching the last
   * `windowMs` (default 2h). Returns whether anything was removed.
   */
  public refundSlidingWindowQuotaByValue(
    name: string,
    member: KvValue,
    opts?: {
      match?: 'contains' | 'endsWith' | 'exact' | 'startsWith'
      windowMs?: number
    },
  ): boolean {
    const key = rateLimitKey(name)
    const serialized = serializeValue(member)
    const matchMode = opts?.match ?? 'exact'
    const now = Date.now()
    const windowMs = opts?.windowMs ?? 120 * 60 * 1000
    const matches = (m: string): boolean => {
      switch (matchMode) {
        case 'contains': {
          return m.includes(serialized)
        }
        case 'endsWith': {
          return m.endsWith(serialized)
        }
        case 'startsWith': {
          return m.startsWith(serialized)
        }
        default: {
          return m === serialized
        }
      }
    }
    const toRemove = this.zRangeByScore(key, now - windowMs, now).filter(matches)
    return toRemove.length > 0 && this.zRem(key, ...toRemove) > 0
  }

  /** Release a slot from `acquireSemaphore`. Safe to call after it expired. */
  public releaseSemaphore(name: string, leaseId: string): void {
    this.zRem(`semaphore:${name}`, leaseId)
  }

  public rPush(key: string, ...values: KvValue[]): number {
    const entry = this.readOrCreate(key, 'list', () => [] as string[])
    entry.value.push(...values.map(serializeValue))
    this.touched(key)
    return entry.value.length
  }

  // ========== Sets ==========

  public sAdd(key: string, ...members: KvValue[]): number {
    const entry = this.readOrCreate(key, 'set', () => new Set<string>())
    let added = 0
    for (const member of members.map(serializeValue)) {
      if (!entry.value.has(member)) {
        entry.value.add(member)
        added++
      }
    }
    this.touched(key)
    return added
  }

  public sCard(key: string): number {
    return this.read(key, 'set')?.value.size ?? 0
  }

  /** Set a value, replacing any TTL: the new one when given, none otherwise. */
  public set(key: string, value: KvValue, ttlSeconds?: number): void {
    this.setWithMs(key, value, ttlSeconds ? ttlSeconds * 1000 : undefined)
  }

  /** Set only when the key is absent. Returns whether it was set. */
  public setNX(key: string, value: KvValue, ttlSeconds?: number): boolean {
    return this.setNXWithMs(key, value, ttlSeconds ? ttlSeconds * 1000 : undefined)
  }

  // ========== Sorted sets ==========

  public setNXWithMs(key: string, value: KvValue, ttlMs?: number): boolean {
    if (this.read(key)) {
      return false
    }
    this.setWithMs(key, value, ttlMs)
    return true
  }

  public setWithMs(key: string, value: KvValue, ttlMs?: number): void {
    this.data.set(key, {
      type: 'string',
      value: serializeValue(value),
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    })
    this.touched(key)
  }

  public sMembers(key: string): string[] {
    return [...(this.read(key, 'set')?.value ?? [])]
  }

  public sRem(key: string, ...members: KvValue[]): number {
    const entry = this.read(key, 'set')
    if (!entry) {
      return 0
    }
    let removed = 0
    for (const member of members.map(serializeValue)) {
      if (entry.value.delete(member)) {
        removed++
      }
    }
    this.dropIfEmpty(key, entry.value.size)
    this.touched(key)
    return removed
  }

  /** Drop every expired key. Runs on a timer; exposed for tests. */
  public sweep(now = Date.now()): number {
    let removed = 0
    for (const [key, entry] of this.data) {
      if (isExpired(entry, now)) {
        this.data.delete(key)
        removed++
      }
    }
    return removed
  }

  /** Remaining TTL in whole seconds (rounded); -2 when missing, -1 when no TTL. */
  public ttl(key: string): number {
    const ms = this.pTTL(key)
    return ms < 0 ? ms : Math.round(ms / 1000)
  }

  /** Add or update members. Returns how many were new. */
  public zAdd(
    key: string,
    scoreMembers: Array<{ score: number; value: KvValue }> | { score: number; value: KvValue },
  ): number {
    const entry = this.readOrCreate(key, 'zset', () => new Map<string, number>())
    let added = 0
    for (const { score, value } of Array.isArray(scoreMembers) ? scoreMembers : [scoreMembers]) {
      const member = serializeValue(value)
      if (!entry.value.has(member)) {
        added++
      }
      entry.value.set(member, score)
    }
    this.touched(key)
    return added
  }

  public zCard(key: string): number {
    return this.read(key, 'zset')?.value.size ?? 0
  }

  public zCount(key: string, min: KvScoreBound, max: KvScoreBound): number {
    return this.zRangeByScoreWithScores(key, min, max).length
  }

  // ========== Semaphores ==========

  /** Members by rank `start..stop` inclusive (ascending score); negative indices allowed. */
  public zRange(key: string, start: number, stop: number): string[] {
    const sorted = this.sortedMembers(key)
    const [from, to] = resolveRange(sorted.length, start, stop)
    return sorted.slice(from, to).map(({ value }) => value)
  }

  public zRangeByScore(key: string, min: KvScoreBound, max: KvScoreBound): string[] {
    return this.zRangeByScoreWithScores(key, min, max).map(({ value }) => value)
  }

  // ========== Sliding windows and rate limits ==========

  public zRangeByScoreWithScores(
    key: string,
    min: KvScoreBound,
    max: KvScoreBound,
  ): Array<{ score: number; value: string }> {
    const lower = parseBound(min)
    const upper = parseBound(max)
    return this.sortedMembers(key).filter(
      ({ score }) =>
        (lower.exclusive ? score > lower.value : score >= lower.value) &&
        (upper.exclusive ? score < upper.value : score <= upper.value),
    )
  }

  /** 0-based rank by ascending score, or null when the member is absent. */
  public zRank(key: string, member: KvValue): null | number {
    const serialized = serializeValue(member)
    const index = this.sortedMembers(key).findIndex(({ value }) => value === serialized)
    return index === -1 ? null : index
  }

  public zRem(key: string, ...members: KvValue[]): number {
    const entry = this.read(key, 'zset')
    if (!entry) {
      return 0
    }
    let removed = 0
    for (const member of members.map(serializeValue)) {
      if (entry.value.delete(member)) {
        removed++
      }
    }
    this.dropIfEmpty(key, entry.value.size)
    this.touched(key)
    return removed
  }

  public zRemRangeByScore(key: string, min: KvScoreBound, max: KvScoreBound): number {
    const doomed = this.zRangeByScore(key, min, max)
    return doomed.length > 0 ? this.zRem(key, ...doomed) : 0
  }

  // ========== Internals ==========

  private dropIfEmpty(key: string, size: number): void {
    if (size === 0) {
      this.data.delete(key)
    }
  }

  private isPersisted(key: string): boolean {
    return this.persistPrefixes.some((prefix) => key.startsWith(prefix))
  }

  private load(file: string): void {
    let parsed: PersistedFile | undefined
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedFile
    } catch {
      // Missing or unreadable: start empty. The next write replaces the file.
      return
    }
    const now = Date.now()
    for (const [key, serialized] of Object.entries(parsed?.entries ?? {})) {
      const entry = deserializeEntry(serialized)
      if (entry && !isExpired(entry, now) && this.isPersisted(key)) {
        this.data.set(key, entry)
      }
    }
  }

  /** Live entry for `key`, dropping it first when expired. Throws on a type mismatch. */
  private read<T extends EntryType>(
    key: string,
    type?: T,
  ): Extract<Entry, { type: T }> | undefined {
    const entry = this.data.get(key)
    if (!entry) {
      return undefined
    }
    if (isExpired(entry, Date.now())) {
      this.data.delete(key)
      return undefined
    }
    if (type && entry.type !== type) {
      throw new KvWrongTypeError()
    }
    return entry as Extract<Entry, { type: T }>
  }

  private readOrCreate<T extends EntryType>(
    key: string,
    type: T,
    init: () => Extract<Entry, { type: T }>['value'],
  ): Extract<Entry, { type: T }> {
    const existing = this.read(key, type)
    if (existing) {
      return existing
    }
    const created = { type, value: init() } as unknown as Extract<Entry, { type: T }>
    this.data.set(key, created)
    return created
  }

  private scheduleFlush(): void {
    if (!this.file || this.pendingFlush) {
      return
    }
    this.pendingFlush = setTimeout(() => this.flush(), this.flushDelayMs)
    this.pendingFlush.unref()
  }

  /** Ascending by score, ties broken by member, matching sorted-set order. */
  private sortedMembers(key: string): Array<{ score: number; value: string }> {
    const entry = this.read(key, 'zset')
    if (!entry) {
      return []
    }
    return [...entry.value]
      .map(([value, score]) => ({ score, value }))
      .sort((a, b) => a.score - b.score || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
  }

  private touched(key: string): void {
    if (this.isPersisted(key)) {
      this.scheduleFlush()
    }
  }
}

export class KvWrongTypeError extends Error {
  constructor() {
    super('WRONGTYPE Operation against a key holding the wrong kind of value')
    this.name = 'KvWrongTypeError'
  }
}

// ========== Helpers ==========

function deserializeEntry(serialized: SerializedEntry): Entry | undefined {
  const { expiresAt } = serialized
  switch (serialized.type) {
    case 'hash': {
      return { type: 'hash', value: new Map(Object.entries(serialized.value)), expiresAt }
    }
    case 'list': {
      return { type: 'list', value: [...serialized.value], expiresAt }
    }
    case 'set': {
      return { type: 'set', value: new Set(serialized.value), expiresAt }
    }
    case 'string': {
      return { type: 'string', value: serialized.value, expiresAt }
    }
    case 'zset': {
      return { type: 'zset', value: new Map(serialized.value), expiresAt }
    }
    default: {
      return undefined
    }
  }
}

function isExpired(entry: Entry, now: number): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= now
}

function parseBound(bound: KvScoreBound): { exclusive: boolean; value: number } {
  if (typeof bound === 'number') {
    return { exclusive: false, value: bound }
  }
  const exclusive = bound.startsWith('(')
  const raw = exclusive ? bound.slice(1) : bound
  if (raw === '-inf') {
    return { exclusive, value: -Infinity }
  }
  if (raw === '+inf' || raw === 'inf') {
    return { exclusive, value: Infinity }
  }
  const value = Number(raw)
  if (Number.isNaN(value)) {
    throw new Error(`min or max is not a float: ${bound}`)
  }
  return { exclusive, value }
}

function parseInteger(value: string): number {
  const num = Number(value)
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(num)) {
    throw new Error('ERR value is not an integer or out of range')
  }
  return num
}

function parseLoose<T>(value: string): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return value as unknown as T
  }
}

function rateLimitKey(name: string): string {
  return `rate_limit_sliding:${name}`
}

/** Inclusive `start..stop` with negative indices, as `[from, to)` slice bounds. */
function resolveRange(length: number, start: number, stop: number): [number, number] {
  const from = Math.max(0, start < 0 ? length + start : start)
  const to = Math.min(length - 1, stop < 0 ? length + stop : stop)
  return from > to ? [0, 0] : [from, to + 1]
}

function serializeEntry(entry: Entry): SerializedEntry {
  const { expiresAt } = entry
  switch (entry.type) {
    case 'hash': {
      return { type: 'hash', value: Object.fromEntries(entry.value), expiresAt }
    }
    case 'list': {
      return { type: 'list', value: entry.value, expiresAt }
    }
    case 'set': {
      return { type: 'set', value: [...entry.value], expiresAt }
    }
    case 'string': {
      return { type: 'string', value: entry.value, expiresAt }
    }
    case 'zset': {
      return { type: 'zset', value: [...entry.value], expiresAt }
    }
  }
}

function serializeValue(value: KvValue): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}
