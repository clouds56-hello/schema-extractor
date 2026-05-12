import type { Schema } from "@/ir/types"

/**
 * A NamePlugin contributes domain-specific knowledge to the extractor:
 *
 *   - `contribute()` injects pipeline config (tag-key hints, dedup hints,
 *     record-collapse hints). Called once during option resolution and
 *     merged with the user-supplied options before the pipeline runs.
 *   - `match()` is invoked per object IR after `hoist-shared`. Plugins
 *     may assign a stable type-alias name and/or force the IR to be
 *     hoisted as a named decl. Plugins are tried in registration order;
 *     the first non-null `match()` wins. Returning `null` defers.
 *
 * Plugins must be conservative: false-positive renames are visible in the
 * emitted .d.ts and silently mislead consumers. Predicates should require
 * tight literal/key conjunctions, not broad heuristics.
 */
export interface PluginContribution {
  multiTagHints?: readonly string[]
  dedupHints?: ReadonlyArray<readonly [string, string]>
  recordHints?: readonly string[]
  /** Partial parameter overrides; keys validated against KNOWN_PARAMETER_KEYS. */
  parameters?: Readonly<Record<string, number>>
}

export interface PluginCtx {
  /** Last property name on the path to this IR ("" at root). */
  field: string
}

export interface PluginMatch {
  /** Replace the auto-generated decl name with this exact string. */
  name?: string
  /** Force-promote this IR to a named decl even if not in `hoistedSet`. */
  hoist?: boolean
}

export interface NamePlugin {
  /** Stable identifier for diagnostics and `--no-plugins` denylists. */
  name: string
  contribute?(): PluginContribution
  match?(ir: Schema, ctx: PluginCtx): PluginMatch | null
}
