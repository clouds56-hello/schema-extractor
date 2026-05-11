import type { Schema } from "../ir/types.js";
import { NEVER } from "../ir/types.js";
import { merge } from "../ir/merge.js";
import { fromValue } from "../ir/from-value.js";
import type { Adapter } from "./types.js";
import { vscodePatchAdapter } from "./vscode-patch.js";
import { codexRolloutAdapter } from "./codex-rollout.js";

export { vscodePatchAdapter, codexRolloutAdapter };
export type { Adapter };

/** Adapter list, in detection priority order. */
export const DEFAULT_ADAPTERS: readonly Adapter[] = [vscodePatchAdapter, codexRolloutAdapter];

/**
 * Run adapters in order over a record batch. First non-null wins. On no match,
 * fall back to per-record `merge(NEVER, fromValue(rec))`.
 */
export function runAdapters(records: readonly unknown[], adapters: readonly Adapter[]): Schema {
  for (const a of adapters) {
    const s = a.detect(records);
    if (s !== null) return s;
  }
  let schema: Schema = NEVER;
  for (const r of records) schema = merge(schema, fromValue(r));
  return schema;
}
