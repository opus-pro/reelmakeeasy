import type { InputJsonValue, PrismaClient } from '@reelmakeeasy/api-db'

// Recursively convert every Date instance (anywhere in a Mongo-shaped filter/$set, including
// nested under $in/$lte/etc.) to the extended-JSON `{ $date: iso }` form. A bare Date or a string
// in a $runCommandRaw command is NOT stored/compared as a real BSON date -- only `{ $date }` is.
// null/string/number/boolean and arrays/plain-objects are passed through (objects recursed).
function toMongo(value: unknown): unknown {
  if (value instanceof Date) {
    return { $date: value.toISOString() }
  }
  if (Array.isArray(value)) {
    return value.map(toMongo)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toMongo(v)]))
  }
  return value
}

// Update Project lifecycle fields via raw Mongo so Prisma's @updatedAt is NOT bumped (these are
// internal anchor writes, not user edits). filter + set are Mongo-shaped; any Date in them is
// converted to { $date: iso }. Returns the modified count. Accepts the base PrismaClient so both
// the NestJS PrismaService (which extends it) and the script's getPrismaInstance() client work.
export async function updateProjectLifecycle(
  prisma: PrismaClient,
  filter: Record<string, unknown>,
  set: Record<string, unknown>,
): Promise<number> {
  // `update` MUST be the first key: Mongo's runCommand reads the first field as the command
  // name (a `const` literal is not reordered by the sort-objects lint rule).
  const command = {
    update: 'Project',
    updates: [{ q: toMongo(filter), u: { $set: toMongo(set) }, multi: true }],
  }
  const res = (await prisma.$runCommandRaw(command as unknown as InputJsonValue & object)) as {
    n?: number
    nModified?: number
    writeErrors?: Array<{ code?: number; errmsg?: string; index?: number }>
  }
  // `$runCommandRaw` reports per-document failures as ok:1 + writeErrors, so a rejected write is
  // indistinguishable from a no-op unless we look. Silence here means a caller believes it persisted
  // state it did not -- for the expiry sent-map that means re-sending the same email every day.
  // Codes only, never errmsg: Mongo error text embeds document values and nothing in this repo is
  // redacted.
  if (res?.writeErrors && res.writeErrors.length > 0) {
    const codes = [...new Set(res.writeErrors.map((e) => e.code ?? 0))].join(',')
    throw new Error(
      `updateProjectLifecycle: ${res.writeErrors.length} write error(s), code(s) ${codes}`,
    )
  }
  return Number(res?.nModified ?? res?.n ?? 0)
}
