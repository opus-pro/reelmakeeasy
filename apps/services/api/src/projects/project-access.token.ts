/**
 * Injection token for the project access check, in a file that imports nothing.
 *
 * `media.controller.ts` cannot `import { ProjectService }` as a VALUE. Doing so
 * closes a circular file import (media -> projects.service -> ... -> media),
 * which leaves the class binding undefined at decoration time and hands
 * `SharedService` an undefined `ProjectService`, crashing the API at boot. A
 * `ModuleRef` lookup does not help, because it needs the same class value as
 * its token.
 *
 * A leaf file with no imports of its own can never participate in a cycle, so
 * the token and its interface live here and the consumer imports only this.
 */
export const PROJECT_ACCESS = Symbol('PROJECT_ACCESS')

export interface ProjectAccess {
  canVisitProject(projectId: string, shareId?: string): Promise<boolean>
}
