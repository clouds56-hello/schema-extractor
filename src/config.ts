import type { Adapter } from "./adapters/index"
import { DEFAULT_ADAPTERS } from "./adapters/index"

export interface ExtractorOptions {
  /** Root type name in emitted .d.ts. Default: `"Root"`. */
  rootName?: string
  /** Extra discriminator key beyond TAG_CANDIDATES. */
  userTagKey?: string | null
  /** `[scopePrefix, namePrefix]` IR-merge hints (Phase 1a). */
  dedupHints?: ReadonlyArray<readonly [string, string]>
  /** Old-chain segment names that force `Record<string, V>` collapse. */
  recordHints?: readonly string[]
  /** Tag keys for global shape consolidation (Phase 1b'). */
  multiTagHints?: readonly string[]
  /** Adapter chain. Defaults to all built-ins; pass `[]` to disable. */
  adapters?: readonly Adapter[]
  /** Override the file header comment. */
  header?: string
}

export interface ResolvedOptions {
  rootName: string
  userTagKey: string | null
  dedupHints: ReadonlyArray<readonly [string, string]>
  recordHints: readonly string[]
  multiTagHints: readonly string[]
  adapters: readonly Adapter[]
  header: string | undefined
}

const DEFAULT_DEDUP_HINTS: ReadonlyArray<readonly [string, string]> = [
  ["CopilotChat_1_V_Variant_Metadata_ToolCallResults_Value_Content", "Children_1"],
  ["CopilotChat_1_V_Variant_Metadata_ToolCallResults_Value_Content", "Children_2"],
]

const DEFAULT_RECORD_HINTS: readonly string[] = ["UserSelectedTools"]

const DEFAULT_MULTI_TAG_HINTS: readonly string[] = ["$mid"]

export function resolveOptions(opts: ExtractorOptions = {}): ResolvedOptions {
  return {
    rootName: opts.rootName ?? "Root",
    userTagKey: opts.userTagKey ?? null,
    dedupHints: opts.dedupHints ?? DEFAULT_DEDUP_HINTS,
    recordHints: opts.recordHints ?? DEFAULT_RECORD_HINTS,
    multiTagHints: opts.multiTagHints ?? DEFAULT_MULTI_TAG_HINTS,
    adapters: opts.adapters ?? DEFAULT_ADAPTERS,
    header: opts.header,
  }
}
