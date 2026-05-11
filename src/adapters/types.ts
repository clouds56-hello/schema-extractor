import type { Schema } from "@/ir/types"

/**
 * An adapter inspects a batch of parsed JSONL records (per-file) and may
 * produce a transformed `Schema` (e.g. by replaying patches). Returning `null`
 * means "this adapter does not apply"; the next adapter is tried, falling back
 * to the default per-record `merge(NEVER, fromValue)` path.
 */
export interface Adapter {
  /** Stable identifier; used for `--no-adapters` denylists, debugging. */
  name: string
  /**
   * Called with the full parsed-record array for one source. Return a Schema
   * to claim the file, or null to defer.
   */
  detect(records: readonly unknown[]): Schema | null
}
