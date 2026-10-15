import { BSON, type Document } from 'mongodb'

import { getSecondaryReadClient, SECONDARY_READ_PREFERENCE } from '../mongo/secondary-read-client'

// Raw MongoDB count utility that bypasses Prisma's $expr-based aggregation.
//
// Prisma's MongoDB adapter wraps ALL `.count()` queries in `$expr` with
// `$$REMOVE` existence checks, preventing index usage and causing full
// collection scans. This utility converts a Prisma WHERE object to a native
// MongoDB filter and runs native aggregate counts which CAN use indexes.
//
// Key translations:
//  - `{ isSet: false }` -> dropped (native `{ field: null }` matches missing fields)
//  - `{ in: [...] }` -> `{ $in: [...] }`
//  - `{ notIn: [...] }` -> `{ $nin: [...] }`
//  - `{ gte/lte/gt/lt: v }` -> `{ $gte/$lte/$gt/$lt: v }`
//  - `{ endsWith: s }` -> `{ $regex: "s$" }`
//  - `{ OR: [...] }` -> `{ $or: [...] }`
//  - `{ AND: [...] }` -> `{ $and: [...] }`
//  - `{ NOT: ... }` -> `{ $nor: [...] }`

type NativeFilter = Record<string, unknown>

const PROJECT_COLLECTION = 'Project'
const MONGO_COUNT_TIMEOUT_MS = 3000

const PRISMA_OPERATOR_MAP: Record<string, string> = {
  equals: '$eq',
  gt: '$gt',
  gte: '$gte',
  in: '$in',
  lt: '$lt',
  lte: '$lte',
  not: '$not',
  notIn: '$nin', // spellchecker: disable-line
}

// Convert a Prisma WhereInput object to a native MongoDB filter.
// Only handles the subset of Prisma operators used by our count queries.
export function prismaWhereToNative(where: Record<string, unknown>): NativeFilter {
  const filter: NativeFilter = {}
  const andClauses: NativeFilter[] = []

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) {
      continue
    }
    convertEntry(key, value, filter, andClauses)
  }

  if (andClauses.length > 0) {
    const existing = filter['$and'] as NativeFilter[] | undefined
    filter['$and'] = [...(existing ?? []), ...andClauses]
  }

  return filter
}

// Convert an array of Prisma WHERE objects, filtering out empty results.
// An empty {} in $or matches everything in MongoDB, so we must drop them.
function convertEntry(
  key: string,
  value: unknown,
  filter: NativeFilter,
  andClauses: NativeFilter[],
): void {
  if (key === 'OR' && Array.isArray(value)) {
    const clauses = convertLogicalArray(value)
    if (clauses.length > 0) {
      filter['$or'] = clauses
    }
    return
  }

  if (key === 'AND') {
    for (const clause of convertLogicalArray(Array.isArray(value) ? value : [value])) {
      andClauses.push(clause)
    }
    return
  }

  if (key === 'NOT') {
    const clauses = convertLogicalArray(Array.isArray(value) ? value : [value])
    if (clauses.length > 0) {
      filter['$nor'] = clauses
    }
    return
  }

  // Scalar value or Date: pass through directly
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    filter[key] = serializeValue(value)
    return
  }

  // Object value: Prisma operators like { in: [...] }, { gte: date }
  const converted = convertFieldOperators(key, value as Record<string, unknown>, andClauses)
  if (converted !== undefined) {
    filter[key] = converted
  }
}

function convertLogicalArray(items: unknown[]): NativeFilter[] {
  return items
    .map((v) => prismaWhereToNative(v as Record<string, unknown>))
    .filter((v) => Object.keys(v).length > 0)
}

// Convert Prisma field-level operators to native MongoDB operators.
function convertFieldOperators(
  fieldKey: string,
  ops: Record<string, unknown>,
  andClauses: NativeFilter[],
): unknown {
  const nativeOps: NativeFilter = {}
  let hasOps = false

  for (const [opKey, opVal] of Object.entries(ops)) {
    if (opKey === 'isSet') {
      continue
    } // native { field: null } matches missing fields

    const converted = convertSingleOperator(opKey, opVal)
    if (converted) {
      nativeOps[converted.key] = converted.value
      hasOps = true
    } else if (opKey === 'OR' || opKey === 'AND' || opKey === 'NOT') {
      andClauses.push(prismaWhereToNative({ [fieldKey]: { [opKey]: opVal } }))
    }
  }

  if (!hasOps) {
    return undefined
  }
  if (Object.keys(nativeOps).length === 1 && '$eq' in nativeOps) {
    return nativeOps['$eq']
  }
  return nativeOps
}

function convertSingleOperator(
  opKey: string,
  opVal: unknown,
): null | { key: string; value: unknown } {
  const mongoOp = PRISMA_OPERATOR_MAP[opKey]
  if (mongoOp) {
    const value =
      mongoOp === '$in' || mongoOp === '$nin' // spellchecker: disable-line
        ? (opVal as unknown[]).map(serializeValue)
        : serializeValue(opVal)
    return { key: mongoOp, value }
  }

  if (opKey === 'endsWith' && typeof opVal === 'string') {
    return { key: '$regex', value: `${escapeRegex(opVal)}$` }
  }
  if (opKey === 'startsWith' && typeof opVal === 'string') {
    return { key: '$regex', value: `^${escapeRegex(opVal)}` }
  }
  if (opKey === 'contains' && typeof opVal === 'string') {
    return { key: '$regex', value: escapeRegex(opVal) }
  }

  return null
}

// ---------------------------------------------------------------------------
// Raw count execution
// ---------------------------------------------------------------------------

// Run a raw MongoDB count against a secondary-preferred client when DATABASE_URL is available.
// Falls back to aggregateRaw in tests or scripts that provide only a mocked Prisma model.
export async function rawCount(
  model: unknown,
  where: Record<string, unknown>,
  collectionName = PROJECT_COLLECTION,
): Promise<number> {
  const filter = prismaWhereToNative(where)
  const mongoUrl = process.env['DATABASE_URL']
  if (mongoUrl) {
    try {
      return await rawMongoCount(
        collectionName,
        BSON.EJSON.deserialize(filter) as NativeFilter,
        mongoUrl,
      )
    } catch {
      return aggregateRawCount(model, filter)
    }
  }

  return aggregateRawCount(model, filter)
}

async function aggregateRawCount(model: unknown, filter: NativeFilter): Promise<number> {
  const aggregateRaw = (model as { aggregateRaw: (args: unknown) => Promise<unknown> }).aggregateRaw
  const result = await aggregateRaw({
    pipeline: [{ $match: filter }, { $count: 'total' }],
  })
  return getCountFromAggregateResult(result)
}

function getCountFromAggregateResult(result: unknown): number {
  if (Array.isArray(result) && result.length > 0) {
    return (result[0] as Document & { total?: number }).total ?? 0
  }
  return 0
}

async function rawMongoCount(
  collectionName: string,
  filter: NativeFilter,
  mongoUrl: string,
): Promise<number> {
  const client = getSecondaryReadClient(mongoUrl)
  const result = await client
    .db()
    .collection(collectionName)
    .aggregate([{ $match: filter }, { $count: 'total' }], {
      maxTimeMS: MONGO_COUNT_TIMEOUT_MS,
      readPreference: SECONDARY_READ_PREFERENCE,
    })
    .toArray()

  return getCountFromAggregateResult(result)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return { $date: value.toISOString() }
  }
  return value
}
