// Keep public routing independent of the preserved legal source catalog.
// Draft documents and their immutable revisions are not public pages.
export const legalPaths = [{ path: '/legal/cookies', noindex: true }]

export function isPublicLegalPath(path: string): boolean {
  return legalPaths.some((route) => route.path === path)
}
