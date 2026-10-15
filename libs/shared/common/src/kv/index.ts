import path from 'node:path'

import { DynamicModule, Global, Module } from '@nestjs/common'

import {
  LONG_TAKE_REQUEST_KEY_PREFIX,
  LONG_TAKE_STATUS_KEY_PREFIX,
} from '../long-take/status-constants'
import { dataDir } from '../storage/file-store'

import { KvStore } from './store'

export {
  type KvScoreBound,
  KvStore,
  type KvStoreOptions,
  type KvValue,
  KvWrongTypeError,
} from './store'

/**
 * Key prefixes written to `<dataDir>/kv.json` and reloaded on boot.
 *
 * Only state the UI reads back after a run has finished belongs here:
 * - `long-take:status:`  the Story Mode status blob a finished project renders from
 * - `long-take:request:` the request metadata (script, style, audio) shown with it
 *
 * Everything else is deliberately process-lifetime only, because a restart ends
 * every in-flight workflow anyway: semaphores and capacity slots, rate limits and
 * quotas, circuit-breaker state, locks and leader leases, the admission queue,
 * dedupe/idempotency keys, response caches, cost roll-ups and the UIP event log.
 */
export const PERSISTED_KEY_PREFIXES: readonly string[] = [
  LONG_TAKE_STATUS_KEY_PREFIX,
  LONG_TAKE_REQUEST_KEY_PREFIX,
]

let store: KvStore | undefined

/**
 * The process-wide store. Until `initKvStore` runs (tests, scripts) this is a
 * purely in-memory store with no file.
 */
export function getKvStore(): KvStore {
  store ??= new KvStore()
  return store
}

/**
 * Create the process-wide store backed by `<dataDir>/kv.json`. Call once at boot,
 * before anything reads from the store; persisted keys from the previous run are
 * loaded here.
 */
export function initKvStore(opts?: { file?: string }): KvStore {
  store?.close()
  store = new KvStore({
    file: opts?.file ?? path.join(dataDir(), 'kv.json'),
    persistPrefixes: PERSISTED_KEY_PREFIXES,
  })
  return store
}

/** Makes `KvStore` injectable, resolving to the process-wide store. */
@Global()
@Module({})
export class KvModule {
  static forRoot(): DynamicModule {
    return {
      module: KvModule,
      providers: [{ provide: KvStore, useFactory: getKvStore }],
      exports: [KvStore],
      global: true,
    }
  }
}
