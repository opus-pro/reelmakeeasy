import { validateImageModelId } from '@reelmakeeasy/common/llm/image-model-selection'

// Structural prisma client (mirrors dominant-image-model.util.ts) so this util
// is testable without the generated client and does not couple to its types.
interface UserDefaultImageModelClient {
  project: {
    findFirst: (args: unknown) => Promise<null | { routedImageModel: null | string }>
  }
}

/**
 * Carried-forward default image model for a user (Cost Phase 2): the
 * model their FIRST PT-routed project actually rendered on, so a do-nothing user
 * keeps getting the same model on later projects. Falls back to the org's config
 * default (NBP) when they have no routed project yet. Read by the selector
 * display and by backend model/charge resolution for non-pickers.
 *
 * Scoped to the current org context (orgId, treating null/undefined as the
 * no-org partition): a login that owns projects in more than one org must not
 * inherit another org's routed model, since the fallback/default config is
 * org-keyed and PT/billing behavior can differ per org.
 */
export async function resolveUserDefaultImageModel(
  prisma: UserDefaultImageModelClient,
  owner: string,
  orgId: null | string | undefined,
): Promise<string> {
  const firstRouted = await prisma.project.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { routedImageModel: true },
    where: { orgId: orgId ?? null, owner, routedImageModel: { not: null } },
  })
  return validateImageModelId(firstRouted?.routedImageModel)
}
