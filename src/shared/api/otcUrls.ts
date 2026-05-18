/**
 * When `quoteBaseUrl` is empty, OTC requests use a path on the current origin.
 * In development with Vite, proxy `/otc/*` to the FastAPI app server rather than to the
 * external upstream directly. The browser still only sees same-origin paths.
 */
export function resolveSameOriginOtcPath(pathFromRoot: string): string {
  return pathFromRoot.startsWith("/") ? pathFromRoot : `/${pathFromRoot}`;
}
