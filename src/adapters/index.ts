import type { Schema } from "@/ir/types"
import { NEVER } from "@/ir/types"
import { merge } from "@/ir/merge"
import { fromValue } from "@/ir/from-value"
import type { Adapter } from "./types"
import { vscodePatchAdapter } from "./vscode-patch"
import { codexRolloutAdapter } from "./codex-rollout"

export { vscodePatchAdapter, codexRolloutAdapter }
export type { Adapter }

/** Adapter list, in detection priority order. */
export const DEFAULT_ADAPTERS: readonly Adapter[] = [vscodePatchAdapter, codexRolloutAdapter]

/**
 * Run adapters in order over a record batch. First non-null wins. On no match,
 * fall back to per-record `merge(NEVER, fromValue(rec))`.
 */
export function runAdapters(records: readonly unknown[], adapters: readonly Adapter[]): Schema {
  for (const a of adapters) {
    const s = a.detect(records)
    if (s !== null) return s
  }
  let schema: Schema = NEVER
  for (const r of records) schema = merge(schema, fromValue(r))
  return schema
}
