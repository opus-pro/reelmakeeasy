import { getLogger } from '@reelmakeeasy/common/logger'
import { MongoClient } from 'mongodb'

const logger = getLogger('secondary-read-client')

// Process-wide MongoClient for analytics-grade reads that must stay OFF the
// primary: connects with readPreference=secondaryPreferred, so a
// query lands on a secondary when one is available and silently degrades to the
// primary when none is -- never worse than the default client, which always
// reads the primary.
//
// Consumers share this ONE client (one connection pool):
//   - projects-raw-count.util: $match+$count, 3s maxTimeMS (fast-fail)
//   - discovery aggregate adapter: $facet pipeline, 60s maxTimeMS
// The 3s connect/serverSelection timeouts below are shared intent for both
// consumers: they bound "pick a server / open a socket", which is orthogonal to
// how long an operation may run. Pass the per-operation budget as maxTimeMS on
// each call; do NOT raise these to accommodate a slow query. Client-level
// switches (retryReads default-on, monitorCommands) are likewise shared --
// changing one changes every consumer.
//
// Testing rule: unit tests mock at the caller's port/model seam and never invoke
// a consumer of this client with DATABASE_URL set -- a developer shell usually
// exports a real one, and the call would hit that database with no fallback.
// Only the integration lane (ephemeral Mongo) exercises this client for real.
const SELECTION_TIMEOUT_MS = 3000

export const SECONDARY_READ_PREFERENCE = 'secondaryPreferred'

let client: MongoClient | null = null
let clientUrl: null | string = null
let routedAddresses = new Set<string>()

export function getSecondaryReadClient(mongoUrl: string): MongoClient {
  if (!client || clientUrl !== mongoUrl) {
    // Best-effort close of a replaced client so its pool and listeners are not
    // leaked (in practice the URL never changes within a process).
    void client?.close().catch(() => undefined)
    client = new MongoClient(mongoUrl, {
      connectTimeoutMS: SELECTION_TIMEOUT_MS,
      monitorCommands: true,
      readPreference: SECONDARY_READ_PREFERENCE,
      serverSelectionTimeoutMS: SELECTION_TIMEOUT_MS,
    })
    clientUrl = mongoUrl
    routedAddresses = new Set()
    // secondaryPreferred degrades to reading the primary with NO error when no
    // secondary is reachable, so where reads actually land is observable only
    // here. Log each address once per client, NOT on every change: server
    // selection picks randomly among in-latency-window members, so with two
    // secondaries the address alternates constantly and a changed-vs-last log
    // would spam on every hot-path count. A failover or a quiet slide onto the
    // primary still leaves a trace the first time that node serves a read.
    client.on('commandStarted', (ev) => {
      if (ev.commandName !== 'aggregate' || routedAddresses.has(ev.address)) {
        return
      }
      routedAddresses.add(ev.address)
      logger.info(`secondary-read aggregate routed to ${ev.address}`)
    })
  }
  return client
}
