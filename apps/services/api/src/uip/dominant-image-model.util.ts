/**
 * Derive the image model that "made" a project, for remix carry-over.
 *
 * `Project.imageModel` only records an EXPLICIT selector choice and is null for
 * most projects and all demos. `GenerationRecord.model` records what actually
 * ran per keyframe (default + fallback-chain included), so it exists even when
 * no selection was made. Heuristic: latest successful record per shot
 * (anchorId), then the modal model across shots -- a late single-shot regen
 * with a different model must not hijack the whole remix. Ties break toward
 * the model whose record is most recent (input is newest-first).
 */

interface DominantModelRecord {
  anchorId: null | string
  model: null | string
}

interface GenerationRecordClient {
  generationRecord: {
    findMany: (args: unknown) => Promise<DominantModelRecord[]>
  }
}

interface SourceImageModelClient extends GenerationRecordClient {
  demoProject: {
    findUnique: (args: unknown) => Promise<null | { sourceProjectId: null | string }>
  }
  project: {
    findUnique: (args: unknown) => Promise<null | { imageModel: null | string }>
  }
}

export function deriveDominantImageModel(records: DominantModelRecord[]): null | string {
  // Records are newest-first; the first record seen per anchorId is the
  // latest for that shot (same rule as the admin report's latestImageModel).
  const latestByShot = new Map<string, string>()
  for (const record of records) {
    if (!record.anchorId || !record.model || latestByShot.has(record.anchorId)) {
      continue
    }
    latestByShot.set(record.anchorId, record.model)
  }
  if (latestByShot.size === 0) {
    return null
  }
  // Modal model across shots. Map iteration preserves insertion order
  // (newest shot first), so on a tie the first-inserted (most recent) wins.
  const counts = new Map<string, number>()
  for (const model of latestByShot.values()) {
    counts.set(model, (counts.get(model) ?? 0) + 1)
  }
  let dominant: null | string = null
  let best = 0
  for (const [model, count] of counts) {
    if (count > best) {
      dominant = model
      best = count
    }
  }
  return dominant
}

export async function fetchDominantImageModel(
  prisma: GenerationRecordClient,
  projectId: string,
): Promise<null | string> {
  try {
    // anchorType 'shot' + task 'long-take-keyframe' scope the read to shot
    // keyframes -- other image records under the same project (UIP
    // anchor-asset generation, style previews) must not influence the
    // dominant model. Rides @@index([projectId, task, createdAt]); take(500)
    // bounds the read.
    const records = await prisma.generationRecord.findMany({
      orderBy: { createdAt: 'desc' },
      select: { anchorId: true, model: true },
      take: 500,
      where: {
        anchorType: 'shot',
        projectId,
        status: 'success',
        task: 'long-take-keyframe',
        type: 'image',
      },
    })
    return deriveDominantImageModel(records)
  } catch {
    // Best-effort: model carry must never break the carry-context read.
    return null
  }
}

/**
 * Image model that "made" a source project: the explicit selector choice
 * when present, else the dominant model across the latest successful
 * keyframe generation records. Best-effort -- null on any failure.
 */
export async function resolveSourceImageModel(
  prisma: SourceImageModelClient,
  projectId: string,
): Promise<null | string> {
  try {
    const project = await prisma.project.findUnique({
      select: { imageModel: true },
      where: { id: projectId },
    })
    if (project?.imageModel) {
      return project.imageModel
    }
    return await fetchDominantImageModel(prisma, projectId)
  } catch {
    return null
  }
}

/**
 * Demo hop: curated demos fail canVisitProject (no Project row) but are public
 * showcases; their generation records live under sourceProjectId. Returns null
 * for non-demo ids (no disclosure for private projects) and for legacy demos
 * without a sourceProjectId. Only a name-only model id is ever derived -- the
 * records themselves (prompts, attempts) are never exposed.
 */
export async function resolveDemoSourceImageModel(
  prisma: SourceImageModelClient,
  demoProjectId: string,
): Promise<null | string> {
  try {
    const demo = await prisma.demoProject.findUnique({
      select: { sourceProjectId: true },
      where: { projectId: demoProjectId },
    })
    if (!demo?.sourceProjectId) {
      return null
    }
    return await resolveSourceImageModel(prisma, demo.sourceProjectId)
  } catch {
    return null
  }
}
