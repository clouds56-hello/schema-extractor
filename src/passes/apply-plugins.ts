import type { NamePlugin, PluginCtx } from "@/plugins/index"
import type { Schema } from "@/ir/types"

export interface PluginsResult {
  canonicalFor: Map<Schema, Schema>
  newHoists: Set<Schema>
  hoistNames: Map<Schema, string>
}

/**
 * Walk the IR tree and consult each plugin per object IR. The first plugin
 * to return non-null wins. Plugin matches may:
 *  - assign a stable type-alias name (overrides hash-based names)
 *  - force-hoist the IR even if not already in `hoistedSet`
 *
 * Plugins never mutate the IR. This pass is purely additive over hoists/names
 * and is not loop-eligible.
 *
 * Names assigned by plugins are FINAL and override any prior auto-generated
 * names. Two plugins may not assign the same name to different IRs; if they
 * do, the renderer's late `dedupeDecls` pass will append `_2` etc. as it
 * does for any name collision.
 */
export function applyPlugins(root: Schema, plugins: readonly NamePlugin[]): PluginsResult {
  const newHoists = new Set<Schema>()
  const hoistNames = new Map<Schema, string>()
  if (plugins.length === 0) return { canonicalFor: new Map(), newHoists, hoistNames }

  const seen = new Set<Schema>()
  const visit = (s: Schema, field: string): void => {
    if (seen.has(s)) return
    seen.add(s)

    if (s.k === "object") {
      const ctx: PluginCtx = { field }
      for (const p of plugins) {
        const m = p.match?.(s, ctx)
        if (!m) continue
        if (m.hoist) newHoists.add(s)
        if (m.name) hoistNames.set(s, m.name)
        break
      }
      for (const [k, prop] of s.props) visit(prop.schema, k)
      return
    }
    if (s.k === "array") {
      visit(s.item, field)
      return
    }
    if (s.k === "record") {
      visit(s.value, field)
      return
    }
    if (s.k === "union") {
      for (const v of s.variants) visit(v, field)
      return
    }
  }

  visit(root, "")
  return { canonicalFor: new Map(), newHoists, hoistNames }
}
