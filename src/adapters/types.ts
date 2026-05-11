import type { Schema } from "@/ir/types"

/**
 * An adapter inspects a batch of parsed JSONL records (per-file) and may
 * produce a transformed `Schema` (e.g. by replaying patches). Returning `null`
 * from `detect` means "this adapter does not apply"; the next adapter is
 * tried, falling back to the default per-record `merge(NEVER, fromValue)`
 * path.
 *
 * Optional `transform` materializes the *records* that semantically correspond
 * to what `detect` produced. Used by `checkJsonlAgainstDts` to validate inputs
 * against a schema that was produced via stateful adaptation. If omitted (or
 * if `detect` returned null for the same batch), the raw records are used.
 */
export interface Adapter {
  /** Stable identifier; used for `--no-adapters` denylists, debugging. */
  name: string
  /**
   * Called with the full parsed-record array for one source. Return a Schema
   * to claim the file, or null to defer.
   */
  detect(records: readonly unknown[]): Schema | null
  /**
   * Optional. When `detect` would return non-null for `records`, return the
   * materialized record stream that the produced Schema describes. Callers
   * use this to bridge raw JSONL to the adapter-shaped data (e.g. `check`).
   * If omitted, callers fall back to raw records.
   */
  transform?(records: readonly unknown[]): readonly unknown[]
}
