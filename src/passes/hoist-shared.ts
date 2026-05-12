import { dryRender } from "@/emit/dry-render"
import { collectHoists, type HoistMeta } from "@/emit/hoist"
import { pascal, ROOT_CTX, sha8 } from "@/emit/name"
import type { Schema } from "@/ir/types"

export interface HoistSharedResult {
  canonicalFor: Map<Schema, Schema>
  newHoists: Set<Schema>
  hoistNames: Map<Schema, string>
}

/**
 * Phase: hoist any object IR that has ≥2 parent references to a named decl.
 *
 * Walks `root`, counting each object IR's reference count. Any object with
 * `refCount >= 2 && props.size >= MIN_KEYS && !hoistedSet.has(s)` becomes a
 * new hoist. Names use `<FieldHint>_Shared_<hash>` where `FieldHint` is the
 * pascal-cased name of the parent field most recently observed for that ref.
 *
 * Pure addition — produces no canonical rewrites. Designed as a final
 * mop-up after structural-dedupe so the renderer doesn't emit identical
 * shape bodies inline N times. Not loop-eligible: only adds names; doesn't
 * change IR shape, so it can't trigger further phase work.
 */
const MIN_KEYS = 2
const MIN_REFS = 2

export function applyHoistShared(root: Schema, hoistedSet: ReadonlySet<Schema>): HoistSharedResult {
  // Render-time auto-promoted union variants get tag-derived names that are
  // strictly more informative than our generic `_Shared_<hash>`. Skip those.
  // An untagged variant (`leaf === "Variant"`) yields a name no better than
  // ours, so still treat it as a candidate when shared in non-variant slots.
  const renderHoists: HoistMeta[] = []
  collectHoists(root, ROOT_CTX("Root"), renderHoists, new Set())
  const taggedVariant = new Set<Schema>()
  for (const m of renderHoists) if (m.leaf !== "Variant") taggedVariant.add(m.ir)

  const refCount = new Map<Schema & { k: "object" }, number>()
  const fieldHint = new Map<Schema & { k: "object" }, string>()

  const seen = new Set<Schema>()
  const visit = (s: Schema, parentField: string): void => {
    if (s.k === "object") {
      refCount.set(s, (refCount.get(s) ?? 0) + 1)
      if (parentField && !fieldHint.has(s)) fieldHint.set(s, parentField)
    }
    if (seen.has(s)) return
    seen.add(s)
    if (s.k === "object") {
      for (const [k, p] of s.props) visit(p.schema, k)
    } else if (s.k === "array") {
      visit(s.item, parentField)
    } else if (s.k === "record") {
      visit(s.value, parentField)
    } else if (s.k === "union") {
      for (const v of s.variants) visit(v, parentField)
    }
  }
  visit(root, "")

  const newHoists = new Set<Schema>()
  const hoistNames = new Map<Schema, string>()
  const usedNames = new Set<string>()

  // Sort for deterministic output: most-referenced first, then by hash.
  const candidates: Array<Schema & { k: "object" }> = []
  for (const [ir, n] of refCount) {
    if (n < MIN_REFS) continue
    if (ir.props.size < MIN_KEYS) continue
    if (hoistedSet.has(ir)) continue
    if (taggedVariant.has(ir)) continue
    candidates.push(ir)
  }
  candidates.sort((a, b) => {
    const da = refCount.get(a)! - refCount.get(b)!
    if (da !== 0) return -da
    return dryRender(a).localeCompare(dryRender(b))
  })

  for (const ir of candidates) {
    const sig = dryRender(ir)
    const hash = sha8(sig)
    const fieldSeg = fieldHint.get(ir)
    const baseName = fieldSeg ? `${pascal(fieldSeg)}_Shared_${hash}` : `Shared_${hash}`
    let name = /^[0-9]/.test(baseName) ? `$${baseName}` : baseName
    let i = 2
    while (usedNames.has(name)) name = `${baseName}_${i++}`
    usedNames.add(name)
    newHoists.add(ir)
    hoistNames.set(ir, name)
  }

  return { canonicalFor: new Map(), newHoists, hoistNames }
}
