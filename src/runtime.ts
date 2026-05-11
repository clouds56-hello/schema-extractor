// Process-level mutable runtime config. Set once by `cli.ts` or by `extractSchema()`
// before any merging happens.

export const runtime = {
  /** User-supplied tag key (overrides TAG_CANDIDATES discrimination). */
  userTagKey: null as string | null,
};

export function setUserTagKey(key: string | null): void {
  runtime.userTagKey = key;
}
