/**
 * Task queues are plain names: every worker runs in this process, so there is
 * no per-developer or per-lane routing to resolve.
 */
export async function resolveTaskQueueForClient(name: string): Promise<string> {
  return name
}

export function resolveTaskQueueForWorker(name: string): string {
  return name
}
