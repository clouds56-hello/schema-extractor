import { mergeParameters } from "../parameters"
import type { NamePlugin, PluginContribution } from "./types"
import { vscodePlugin } from "./vscode"

export type { NamePlugin, PluginContribution, PluginCtx, PluginMatch } from "./types"
export { vscodePlugin }

/** Plugin chain, in registration / match-priority order. */
export const DEFAULT_PLUGINS: readonly NamePlugin[] = [vscodePlugin]

/**
 * Registry of built-in plugins keyed by `NamePlugin.name`. Used by the
 * manifest loader to resolve `options.plugins: string[]` into actual plugin
 * objects. External plugin loading (npm packages, file paths) is a future
 * extension; for now only registered names are accepted.
 */
export const BUILTIN_PLUGINS: Readonly<Record<string, NamePlugin>> = {
  [vscodePlugin.name]: vscodePlugin,
}

/**
 * Resolve a list of plugin names to plugin objects. Throws on unknown names
 * with a message listing the available built-ins.
 */
export function resolvePluginNames(names: readonly string[]): readonly NamePlugin[] {
  const out: NamePlugin[] = []
  for (const n of names) {
    const p = BUILTIN_PLUGINS[n]
    if (!p) {
      const known = Object.keys(BUILTIN_PLUGINS).join(", ") || "(none)"
      throw new Error(`unknown plugin "${n}". Known built-ins: ${known}`)
    }
    out.push(p)
  }
  return out
}

/**
 * Merge contributions from a plugin chain into a single accumulated record.
 * Order is preserved; duplicates are de-duplicated key-wise (multiTagHints,
 * recordHints by string identity; dedupHints by `${scope}\x00${name}`).
 * Parameter overrides are last-write-wins across the plugin chain.
 */
export function collectContributions(plugins: readonly NamePlugin[]): Required<PluginContribution> {
  const tags = new Set<string>()
  const records = new Set<string>()
  const dedup = new Map<string, readonly [string, string]>()
  let params: Record<string, number> = {}
  for (const p of plugins) {
    const c = p.contribute?.()
    if (!c) continue
    for (const t of c.multiTagHints ?? []) tags.add(t)
    for (const r of c.recordHints ?? []) records.add(r)
    for (const pair of c.dedupHints ?? []) dedup.set(`${pair[0]}\x00${pair[1]}`, pair)
    if (c.parameters) {
      try {
        // mergeParameters validates known-key + non-negative-integer.
        params = { ...mergeParameters(params, c.parameters) }
      } catch (e) {
        throw new Error(`plugin "${p.name}": ${(e as Error).message}`)
      }
    }
  }
  return {
    multiTagHints: [...tags],
    recordHints: [...records],
    dedupHints: [...dedup.values()],
    parameters: params,
  }
}
