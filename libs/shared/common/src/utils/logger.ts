export type NsLoggerEntryCounts = {
  assert: number
  clear: number
  count: number
  countReset: number
  debug: number
  dir: number
  dirxml: number
  error: number
  group: number
  groupCollapsed: number
  groupEnd: number
  info: number
  log: number
  profile: number
  profileEnd: number
  table: number
  time: number
  timeEnd: number
  timeLog: number
  timeStamp: number
  trace: number
  traceCollapsed: number
  warn: number
  whenEnabled: number
}
export type RestrictedConsoleLogger = Omit<Console, 'Console'>

/**
 * Design intent:
 * Frontend log output is very noisy in a multi-developer codebase, and raw console logs
 * are hard to attribute to the module that produced them.
 *
 * `NsLogger` enforces a stable prefix (`[title]`, defaulting to namespace) so every line is
 * traceable back to a feature/module, while keeping native console call signatures for debugging.
 * Pass `title = ''` to disable prefixing and keep pure console forwarding behavior.
 *
 * Call stack tip (Chrome DevTools):
 * Settings -> Ignore list -> Custom exclusion rules -> add `utils/logger`.
 * This hides the logger wrapper frame so stack traces point to original call sites.
 *
 * @example
 * ```ts
 * // 1) Use `enabled` only as a signal, and keep custom raw-logger behavior below.
 * const rawLogger = Logger.get('notification', '')
 * if (rawLogger.enabled) {
 *   rawLogger.group('Notification Debug')
 *   rawLogger.table(payload)
 *   rawLogger.groupEnd()
 * }
 * ```
 *
 * @example
 * ```ts
 * // 2) Wrap debug blocks with `whenEnabled`.
 * const nsLogger = Logger.get('render', 'Render Debug')
 * nsLogger.whenEnabled((logger) => {
 *   logger.group('Config Check')
 *   logger.log('value:', config)
 *   logger.groupEnd()
 * })
 * ```
 *
 * @example
 * ```ts
 * // 3) Directly use logger interfaces for regular log lines.
 * const nsLogger = Logger.get('project.export', 'Export')
 * nsLogger.info('Started')
 * nsLogger.error('Failed:', err)
 * ```
 */
export class NsLogger implements RestrictedConsoleLogger {
  /**
   * Per-entry invocation counts for this logger instance (`ns` + `title`).
   * Counts are incremented on method entry, even when the logger is currently disabled.
   */
  readonly counts: NsLoggerEntryCounts = {
    assert: 0,
    clear: 0,
    count: 0,
    countReset: 0,
    debug: 0,
    dir: 0,
    dirxml: 0,
    error: 0,
    group: 0,
    groupCollapsed: 0,
    groupEnd: 0,
    info: 0,
    log: 0,
    profile: 0,
    profileEnd: 0,
    table: 0,
    time: 0,
    timeEnd: 0,
    timeLog: 0,
    timeStamp: 0,
    trace: 0,
    traceCollapsed: 0,
    warn: 0,
    whenEnabled: 0,
  }

  enabled = true

  // Cached once to avoid rebuilding `[title]` on every log call.
  private _prefix: string
  private _usePrefix: boolean

  /**
   * @param ns Logical namespace used for filtering rules.
   * @param title Prefix label shown in logs. Pass an empty string to disable prefix injection.
   * @param logger Destination logger implementation, defaults to global `console`.
   */
  constructor(
    readonly ns: string,
    readonly title = ns,
    readonly logger: RestrictedConsoleLogger = console,
  ) {
    this._usePrefix = title !== ''
    this._prefix = this._usePrefix ? `[${title}]` : ''
  }

  assert(condition?: boolean, ...data: unknown[]) {
    this.counts.assert += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.assert(condition, ...data)
    }
    if (typeof data[0] === 'string') {
      // Preserve printf-style formatting by prefixing the message template itself.
      data[0] = `${this._prefix} ${data[0]}`
      return this.logger.assert(condition, ...data)
    }
    // Non-string first arg (often objects/errors) keeps original payload order.
    return this.logger.assert(condition, this._prefix, ...data)
  }

  clear() {
    this.counts.clear += 1
    if (!this.enabled) {
      return
    }
    return this.logger.clear()
  }

  count(label = 'default') {
    this.counts.count += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.count(label)
    }
    return this.logger.count(`${this._prefix} ${label}`)
  }

  countReset(label = 'default') {
    this.counts.countReset += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.countReset(label)
    }
    return this.logger.countReset(`${this._prefix} ${label}`)
  }

  debug(...args: unknown[]) {
    this.counts.debug += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.debug(...args)
    }
    if (typeof args[0] === 'string') {
      // Mutating the local rest array avoids extra spread/concat allocations on hot paths.
      args[0] = `${this._prefix} ${args[0]}`
      return this.logger.debug(...args)
    }
    return this.logger.debug(this._prefix, ...args)
  }

  dir(item?: unknown, options?: object) {
    this.counts.dir += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.dir(item, options)
    }
    // `console.dir` has no clear message slot; use a temporary group so namespace stays visible.
    this.logger.group(this._prefix, 'dir')
    this.logger.dir(item, options)
    this.logger.groupEnd()
  }

  dirxml(...data: unknown[]) {
    this.counts.dirxml += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.dirxml(...data)
    }
    // Same rationale as `dir`: wrap with a group instead of altering inspected payload.
    this.logger.group(this._prefix, 'dirxml')
    this.logger.dirxml(...data)
    this.logger.groupEnd()
  }

  error(...args: unknown[]) {
    this.counts.error += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.error(...args)
    }
    if (typeof args[0] === 'string') {
      args[0] = `${this._prefix} ${args[0]}`
      return this.logger.error(...args)
    }
    return this.logger.error(this._prefix, ...args)
  }

  group(...args: unknown[]) {
    this.counts.group += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.group(...args)
    }
    if (typeof args[0] === 'string') {
      args[0] = `${this._prefix} ${args[0]}`
      return this.logger.group(...args)
    }
    return this.logger.group(this._prefix, ...args)
  }

  groupCollapsed(...args: unknown[]) {
    this.counts.groupCollapsed += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.groupCollapsed(...args)
    }
    if (typeof args[0] === 'string') {
      args[0] = `${this._prefix} ${args[0]}`
      return this.logger.groupCollapsed(...args)
    }
    return this.logger.groupCollapsed(this._prefix, ...args)
  }

  groupEnd() {
    this.counts.groupEnd += 1
    if (!this.enabled) {
      return
    }
    return this.logger.groupEnd()
  }

  info(...args: unknown[]) {
    this.counts.info += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.info(...args)
    }
    if (typeof args[0] === 'string') {
      args[0] = `${this._prefix} ${args[0]}`
      return this.logger.info(...args)
    }
    return this.logger.info(this._prefix, ...args)
  }

  log(...args: unknown[]) {
    this.counts.log += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.log(...args)
    }
    return this.logger.log(this._prefix, ...args)
  }

  profile(label = 'default') {
    this.counts.profile += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.profile(label)
    }
    return this.logger.profile(`${this._prefix} ${label}`)
  }

  profileEnd(label = 'default') {
    this.counts.profileEnd += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.profileEnd(label)
    }
    return this.logger.profileEnd(`${this._prefix} ${label}`)
  }

  table(tabularData: unknown, properties?: readonly string[]) {
    this.counts.table += 1
    if (!this.enabled) {
      return
    }
    return this.logger.table(tabularData, properties)
  }

  time(label = 'default') {
    this.counts.time += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.time(label)
    }
    return this.logger.time(`${this._prefix} ${label}`)
  }

  timeEnd(label = 'default') {
    this.counts.timeEnd += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.timeEnd(label)
    }
    return this.logger.timeEnd(`${this._prefix} ${label}`)
  }

  timeLog(label = 'default', ...args: unknown[]) {
    this.counts.timeLog += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.timeLog(label, ...args)
    }
    return this.logger.timeLog(`${this._prefix} ${label}`, ...args)
  }

  timeStamp(label = 'default') {
    this.counts.timeStamp += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.timeStamp(label)
    }
    return this.logger.timeStamp(`${this._prefix} ${label}`)
  }

  trace(...args: unknown[]) {
    this.counts.trace += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.trace(...args)
    }
    if (typeof args[0] === 'string') {
      args[0] = `${this._prefix} ${args[0]}`
      return this.logger.trace(...args)
    }
    return this.logger.trace(this._prefix, ...args)
  }

  traceCollapsed(...args: unknown[]) {
    this.counts.traceCollapsed += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      this.logger.groupCollapsed(...args)
      this.logger.trace()
      this.logger.groupEnd()
      return
    }
    if (typeof args[0] === 'string') {
      args[0] = `${this._prefix} ${args[0]}`
      this.logger.groupCollapsed(...args)
    } else {
      this.logger.groupCollapsed(this._prefix, ...args)
    }
    // Trace is intentionally called without forwarding `args`:
    // the group title carries user context, while trace prints stack only once.
    this.logger.trace()
    this.logger.groupEnd()
  }

  warn(...args: unknown[]) {
    this.counts.warn += 1
    if (!this.enabled) {
      return
    }
    if (!this._usePrefix) {
      return this.logger.warn(...args)
    }
    if (typeof args[0] === 'string') {
      args[0] = `${this._prefix} ${args[0]}`
      return this.logger.warn(...args)
    }
    return this.logger.warn(this._prefix, ...args)
  }

  whenEnabled<T>(block: (logger: NsLogger) => T) {
    this.counts.whenEnabled += 1
    if (!this.enabled) {
      return
    }
    return block(this)
  }
}

/**
 * Design intent:
 * Keep one shared rule pipeline for all namespace loggers so developers can incrementally
 * include/exclude namespaces and focus on the logs they care about, without touching call sites.
 */
export class NsLoggerStore {
  // Compiled matchers avoid re-branching on rule shape for every logger lookup/evaluation.
  private _compiledRules: Array<{
    readonly match: (ns: string) => boolean
    readonly type: NsLoggerFilterRule['type']
  }> = []
  // Per-namespace default enabled values, set via get() options. Rules override these.
  private _defaultEnabled = new Map<string, boolean>()
  // Cache logger instances by namespace and title, so each ns can expose multiple named views.
  private _loggers = new Map<string, Map<string, NsLogger>>()
  // Keep original rules to support inspection and incremental appends.
  private _rules: NsLoggerFilterRule[] = []

  /**
   * Appends rules to the current rule chain.
   * Rules are evaluated in insertion order, and later matches override earlier matches.
   */
  appendRules(rules: readonly NsLoggerFilterRule[]) {
    if (rules.length === 0) {
      return
    }

    this._rules.push(...rules)
    for (const rule of rules) {
      this._compiledRules.push({
        match: this._toMatcher(rule.match),
        type: rule.type,
      })
    }
    this._syncEnabledStates()
  }

  /**
   * Gets (or lazily creates) a logger instance for the given namespace/title pair.
   * Use this as the single entry point for logger reuse and rule-aware enablement.
   *
   * @param ns Namespace used by filtering rules.
   * @param title Prefix title passed to `NsLogger`; pass `''` for raw pass-through logger behavior.
   *
   * @example
   * ```ts
   * const logger = Logger.get('project.debug', 'DEBUG')
   * logger.log('Ping response:', payload)
   *
   * const rawLogger = Logger.get('notification', '')
   * if (rawLogger.enabled) {
   *   rawLogger.group('Notification Debug')
   *   rawLogger.table(rows)
   *   rawLogger.groupEnd()
   * }
   * ```
   */
  get(ns: string, titleOrOptions?: string | { defaultEnabled?: boolean; title?: string }) {
    const title =
      typeof titleOrOptions === 'string' ? titleOrOptions : (titleOrOptions?.title ?? ns)
    const options = typeof titleOrOptions === 'object' ? titleOrOptions : undefined

    if (options?.defaultEnabled !== undefined) {
      this._defaultEnabled.set(ns, options.defaultEnabled)
    }

    let namespaceLoggers = this._loggers.get(ns)
    if (!namespaceLoggers) {
      namespaceLoggers = new Map<string, NsLogger>()
      this._loggers.set(ns, namespaceLoggers)
    }

    const current = namespaceLoggers.get(title)
    if (current) {
      return current
    }

    const logger = new NsLogger(ns, title)
    logger.enabled = this._isEnabled(ns)
    namespaceLoggers.set(title, logger)
    return logger
  }

  /**
   * Returns the current effective rule list in insertion order.
   */
  getRules(): readonly NsLoggerFilterRule[] {
    return this._rules
  }

  /**
   * Replaces the full rule set and reapplies enabled state to existing logger instances.
   */
  setRules(rules: readonly NsLoggerFilterRule[]) {
    // Full replace: clear previous rule state, then rebuild from the new baseline.
    this._rules = []
    this._compiledRules = []
    if (rules.length === 0) {
      // Empty rules means default "allow all".
      this._syncEnabledStates()
      return
    }
    return this.appendRules(rules)
  }

  private _isEnabled(ns: string): boolean {
    let enabled = this._defaultEnabled.get(ns) ?? true
    for (const rule of this._compiledRules) {
      if (rule.match(ns)) {
        enabled = rule.type === 'include'
      }
    }
    return enabled
  }

  private _isSetLike(value: unknown): value is { readonly has: (ns: string) => unknown } {
    // Accept any set-like object with `has()` to support ReadonlySet interfaces and set wrappers.
    return (
      typeof value === 'object' &&
      value !== null &&
      'has' in value &&
      typeof value.has === 'function'
    )
  }

  private _syncEnabledStates() {
    for (const [ns, namespaceLoggers] of this._loggers.entries()) {
      const enabled = this._isEnabled(ns)
      for (const logger of namespaceLoggers.values()) {
        logger.enabled = enabled
      }
    }
  }

  private _toMatcher(match: NsLoggerFilterRule['match']): (ns: string) => boolean {
    if (typeof match === 'function') {
      return (ns: string) => Boolean(match(ns))
    }
    if (match instanceof RegExp) {
      return (ns: string) => {
        // Guard against sticky/global regex state leaking across calls.
        match.lastIndex = 0
        return match.test(ns)
      }
    }
    if (this._isSetLike(match)) {
      return (ns: string) => Boolean(match.has(ns))
    }
    return (ns: string) => Boolean(match[ns])
  }
}

export const Logger = new NsLoggerStore()

/**
 * A single namespace filter rule used by `NsLoggerStore`.
 * Rules are applied in insertion order, and later matching rules override earlier ones.
 */
export type NsLoggerFilterRule = {
  /**
   * Namespace matcher.
   * Supports function, RegExp, record lookup, or any set-like object with `has(ns)`.
   */
  readonly match:
    | ((ns: string) => unknown)
    | Readonly<Record<string, unknown>>
    | RegExp
    | { readonly has: (ns: string) => unknown }
  /** `include` enables matching namespaces, `exclude` disables matching namespaces. */
  readonly type: 'exclude' | 'include'
}
