import "server-only";

/**
 * Removes the filters a plan does not include, so they are not applied
 * server-side, and returns their names so the UI can say they were ignored.
 */
export function stripFilters<T extends object>(query: T, keys: readonly string[]): { query: T; ignored: string[] } {
  const out = { ...query } as Record<string, unknown>;
  const ignored: string[] = [];
  for (const k of keys) {
    const v = out[k];
    if (v != null && v !== false && !(Array.isArray(v) && v.length === 0)) {
      ignored.push(k);
      out[k] = Array.isArray(v) ? [] : undefined;
    }
  }
  return { query: out as T, ignored };
}
