import type { NamePlugin, PluginContribution } from "./types"
import { vscodePlugin } from "./vscode"

export type { NamePlugin, PluginContribution, PluginCtx, PluginMatch } from "./types"
export { vscodePlugin }

/** Plugin chain, in registration / match-priority order. */
export const DEFAULT_PLUGINS: readonly NamePlugin[] = [vscodePlugin]

/**
 * Merge contributions from a plugin chain into a single accumulated record.
 * Order is preserved; duplicates are de-duplicated key-wise (multiTagHints,
 * recordHints by string identity; dedupHints by `${scope}\x00${name}`).
 */
export function collectContributions(plugins: readonly NamePlugin[]): Required<PluginContribution> {
  const tags = new Set<string>()
  const records = new Set<string>()
  const dedup = new Map<string, readonly [string, string]>()
  for (const p of plugins) {
    const c = p.contribute?.()
    if (!c) continue
    for (const t of c.multiTagHints ?? []) tags.add(t)
    for (const r of c.recordHints ?? []) records.add(r)
    for (const pair of c.dedupHints ?? []) dedup.set(`${pair[0]}\x00${pair[1]}`, pair)
  }
  return {
    multiTagHints: [...tags],
    recordHints: [...records],
    dedupHints: [...dedup.values()],
  }
}
