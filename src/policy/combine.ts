import type { Schema } from "../ir/types.js";
import { merge, mergeRecordWithObject } from "../ir/merge.js";
import { compatibleForMerge, pickTagLiteral } from "../ir/tags.js";
import { dryRender } from "../emit/dry-render.js";
import { pickCanonIndex } from "./pickers.js";
import { policyAccepts } from "./predicates.js";
import { STREAM_MERGE_POLICY } from "./presets.js";
import type { CombineKind, MergePolicy } from "./types.js";
import type { HoistMeta } from "../emit/hoist.js";

// Re-export so callers don't need a separate import path.
export { policyAccepts };

/**
 * Returns true on success, false if the merge could not produce an object IR.
 * Callers using "deep" should abort the whole group on failure (mirrors the
 * legacy behavior where a tagged-union split during merge caused the entire
 * connected-component to be skipped).
 */
export function combineInto(
  canon: Schema & { k: "object" },
  other: Schema & { k: "object" },
  combine: CombineKind,
): boolean {
  switch (combine) {
    case "deep": {
      const merged = merge(canon, other);
      if (merged.k !== "object") return false;
      canon.props = merged.props;
      canon.total = merged.total;
      return true;
    }
    case "deep-safe": {
      const merged = mergeDeepSafe(canon, other);
      if (!merged || merged.k !== "object") return false;
      canon.props = merged.props;
      canon.total = merged.total;
      return true;
    }
    case "shallow": {
      for (const [k, p] of other.props) {
        const existing = canon.props.get(k);
        if (existing) {
          existing.present += p.present;
          if (existing.schema.k === "prim" && p.schema.k === "prim") {
            const merged = merge(existing.schema, p.schema);
            if (merged.k === "prim" || merged.k === "union") existing.schema = merged;
          }
        } else {
          canon.props.set(k, { schema: p.schema, present: p.present });
        }
      }
      canon.total += other.total;
      return true;
    }
    case "structural":
    case "rename-only":
      return true;
  }
}

export function mergeDeepSafe(a: Schema, b: Schema, seen = new Map<Schema, Set<Schema>>()): Schema | null {
  if (a === b) return a;
  const prior = seen.get(a);
  if (prior?.has(b)) return a;
  if (prior) prior.add(b);
  else seen.set(a, new Set([b]));

  if (a.k === "never") return b;
  if (b.k === "never") return a;
  if (a.k === "any" || b.k === "any") return { k: "any" };

  if (a.k === "union") return mergeUnionDeepSafe(a, b, seen);
  if (b.k === "union") return mergeUnionDeepSafe(b, a, seen);

  if (a.k === "prim" && b.k === "prim") return merge(a, b);
  if (a.k === "array" && b.k === "array") {
    const item = mergeDeepSafe(a.item, b.item, seen);
    return item ? { k: "array", item } : null;
  }
  if (a.k === "record" && b.k === "record") {
    const value = mergeDeepSafe(a.value, b.value, seen);
    if (!value) return null;
    return { k: "record", key: a.key === b.key ? a.key : "string", value };
  }
  if (a.k === "record" && b.k === "object") return mergeRecordWithObject(a, b);
  if (b.k === "record" && a.k === "object") return mergeRecordWithObject(b, a);
  if (a.k === "object" && b.k === "object") return mergeObjectsDeepSafe(a, b, seen);
  return dryRender(a) === dryRender(b) ? a : null;
}

function mergeUnionDeepSafe(u: Schema & { k: "union" }, x: Schema, seen: Map<Schema, Set<Schema>>): Schema | null {
  if (x.k === "union") {
    let acc: Schema | null = u;
    for (const v of x.variants) {
      if (!acc) return null;
      acc = mergeUnionDeepSafe(acc.k === "union" ? acc : { k: "union", variants: [acc] }, v, seen);
    }
    return acc;
  }
  const variants: Schema[] = [];
  let placed = false;
  for (const variant of u.variants) {
    if (!placed && compatibleForMerge(variant, x)) {
      const merged = mergeDeepSafe(variant, x, seen);
      if (merged) {
        variants.push(merged);
        placed = true;
        continue;
      }
    }
    variants.push(variant);
  }
  if (!placed) variants.push(x);
  return variants.length === 1 ? variants[0]! : { k: "union", variants };
}

function mergeObjectsDeepSafe(
  a: Schema & { k: "object" },
  b: Schema & { k: "object" },
  seen: Map<Schema, Set<Schema>>,
): Schema | null {
  if (!policyAccepts(a, b, STREAM_MERGE_POLICY)) return null;
  const props = new Map<string, { schema: Schema; present: number }>();
  const total = a.total + b.total;
  const allKeys = new Set<string>([...a.props.keys(), ...b.props.keys()]);
  for (const k of allKeys) {
    const pa = a.props.get(k);
    const pb = b.props.get(k);
    if (pa && pb) {
      const merged = mergeDeepSafe(pa.schema, pb.schema, seen);
      if (!merged) return null;
      props.set(k, { schema: merged, present: pa.present + pb.present });
    } else if (pa) {
      props.set(k, { schema: pa.schema, present: pa.present });
    } else if (pb) {
      props.set(k, { schema: pb.schema, present: pb.present });
    }
  }
  return { k: "object", total, props };
}

/**
 * Merge `group` according to `policy`. Returns the canonical HoistMeta on
 * success, null on failure.
 *
 * Semantics by combine kind:
 *   - "deep":    ATOMIC — gates/similar are NOT pair-pre-checked; instead the
 *                whole group is folded into canon and aborted if the merge
 *                collapses canon.k away from "object".
 *   - "shallow"/"deep-safe": PER-PAIR gated — each (canon, member) pair is
 *                admitted via policyAccepts; failures are silently skipped.
 */
export function mergeGroup(
  group: HoistMeta[],
  policy: MergePolicy,
  canonicalFor: Map<Schema, Schema>,
): HoistMeta | null {
  if (group.length < 2) return null;
  const canonIdx = pickCanonIndex(group, policy.pick);
  const canon = group[canonIdx]!;

  if (policy.combine === "deep") {
    const snapshotProps = new Map(canon.ir.props);
    const snapshotTotal = canon.ir.total;
    const pendingMap: Array<Schema & { k: "object" }> = [];
    for (let k = 0; k < group.length; k++) {
      if (k === canonIdx) continue;
      const ok = combineInto(canon.ir, group[k]!.ir, "deep");
      if (!ok) {
        canon.ir.props = snapshotProps;
        canon.ir.total = snapshotTotal;
        return null;
      }
      pendingMap.push(group[k]!.ir);
    }
    for (const o of pendingMap) canonicalFor.set(o, canon.ir);
    cycleSplice(canon.ir, canonicalFor);
    return canon;
  }

  for (let k = 0; k < group.length; k++) {
    if (k === canonIdx) continue;
    const other = group[k]!;
    if (!policyAccepts(canon.ir, other.ir, policy)) continue;
    if (!combineInto(canon.ir, other.ir, policy.combine)) continue;
    canonicalFor.set(other.ir, canon.ir);
  }
  cycleSplice(canon.ir, canonicalFor);
  return canon;
}

/**
 * Walk `canon`'s substructure and substitute any nested object IR sharing the same
 * (tagKey, tagValue) with the canon ref. Mutates union.variants in place and
 * updates `canonicalFor` so other tree references rewrite to canon too.
 */
export function cycleSplice(canon: Schema & { k: "object" }, canonicalFor: Map<Schema, Schema>): void {
  const canonTag = pickTagLiteral(canon);
  if (!canonTag) return;
  const stack: Schema[] = [canon];
  const visited = new Set<Schema>([canon]);
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.k === "object") {
      for (const p of cur.props.values()) {
        if (visited.has(p.schema)) continue;
        visited.add(p.schema);
        stack.push(p.schema);
      }
    } else if (cur.k === "array") {
      if (!visited.has(cur.item)) { visited.add(cur.item); stack.push(cur.item); }
    } else if (cur.k === "record") {
      if (!visited.has(cur.value)) { visited.add(cur.value); stack.push(cur.value); }
    } else if (cur.k === "union") {
      for (let vi = 0; vi < cur.variants.length; vi++) {
        const v = cur.variants[vi]!;
        if (v.k === "object" && v !== canon) {
          const tag = pickTagLiteral(v);
          if (tag && tag.key === canonTag.key && tag.value === canonTag.value) {
            canonicalFor.set(v, canon);
            cur.variants[vi] = canon;
            continue;
          }
        }
        if (!visited.has(v)) { visited.add(v); stack.push(v); }
      }
    }
  }
}
