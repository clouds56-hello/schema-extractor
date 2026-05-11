import type { Schema } from "../ir/types.js";
import { pickTagLiteral } from "../ir/tags.js";
import {
  type PathCtx,
  descendArray,
  descendField,
  descendRecord,
  descendVariant,
  descendVariantFallback,
  pascal,
} from "./name.js";

export interface HoistMeta {
  ir: Schema & { k: "object" };
  /** == sub.old at the point emitNamedObject would store it. */
  oldChain: string;
  /** Tag string or "Variant". */
  leaf: string;
  /** PathCtx.field at parent. */
  field: string;
  pretty: string;
}

export function collectHoists(s: Schema, p: PathCtx, out: HoistMeta[], seen: Set<Schema>): void {
  if (seen.has(s)) return;
  seen.add(s);
  switch (s.k) {
    case "array":
      collectHoists(s.item, descendArray(p), out, seen);
      return;
    case "record":
      collectHoists(s.value, descendRecord(p), out, seen);
      return;
    case "object":
      for (const [k, { schema }] of s.props) collectHoists(schema, descendField(p, k), out, seen);
      return;
    case "union":
      for (const v of s.variants) {
        if (v.k === "object") {
          const tag = pickTagLiteral(v);
          const sub = tag ? descendVariant(p, tag.value) : descendVariantFallback(p);
          const leaf = tag ? String(tag.value) : "Variant";
          out.push({ ir: v, oldChain: sub.old, leaf, field: p.field, pretty: sub.pretty });
          for (const [k, { schema }] of v.props) collectHoists(schema, descendField(sub, k), out, seen);
        } else {
          collectHoists(v, descendVariantFallback(p), out, seen);
        }
      }
      return;
    default:
      return;
  }
}

export function namePrefixOf(h: HoistMeta): string {
  const fieldSeg = h.field ? pascal(h.field) : "";
  const leafSeg = pascal(h.leaf);
  const raw = fieldSeg ? `${fieldSeg}_${leafSeg}` : leafSeg;
  return /^[0-9]/.test(raw) ? `$${raw}` : raw;
}

export function makeInlineMeta(s: Schema & { k: "object" }): HoistMeta {
  return { ir: s, oldChain: "", leaf: "", field: "", pretty: "" };
}
