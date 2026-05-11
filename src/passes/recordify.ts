import type { Schema } from "../ir/types.js";
import { NEVER } from "../ir/types.js";
import { detectKeyAlias } from "../ir/alias.js";
import { merge } from "../ir/merge.js";
import { pickTagLiteral } from "../ir/tags.js";
import {
  type PathCtx,
  ROOT_CTX,
  descendArray,
  descendField,
  descendRecord,
  descendVariant,
  descendVariantFallback,
} from "../emit/name.js";

/**
 * Phase 0: collapse alias-keyed objects (e.g., all-Path-keyed) into
 * `Record<KeyAlias, V>`. Also force-recordifies objects whose oldChain matches
 * a `recordHints` entry — those become `Record<string, V>` regardless of key shape.
 */
export function applyRecordify(root: Schema, rootName: string, recordHints: readonly string[]): Map<Schema, Schema> {
  const canonicalFor = new Map<Schema, Schema>();
  const seen = new Set<Schema>();

  function walk(s: Schema, p: PathCtx) {
    if (seen.has(s)) return;
    seen.add(s);
    switch (s.k) {
      case "array":
        walk(s.item, descendArray(p));
        return;
      case "record":
        walk(s.value, descendRecord(p));
        return;
      case "union":
        for (const v of s.variants) {
          if (v.k === "object") {
            const tag = pickTagLiteral(v);
            walk(v, tag ? descendVariant(p, tag.value) : descendVariantFallback(p));
          } else {
            walk(v, descendVariantFallback(p));
          }
        }
        return;
      case "object": {
        for (const [k, prop] of s.props) walk(prop.schema, descendField(p, k));
        if (s.props.size === 0) return;
        const keys = [...s.props.keys()];
        const hinted = (() => {
          const padded = "_" + p.old + "_";
          return recordHints.some((h) => padded.includes("_" + h + "_"));
        })();
        const alias = hinted ? "string" : detectKeyAlias(keys);
        if (!hinted && alias === "string") return;
        let val: Schema = NEVER;
        for (const { schema } of s.props.values()) val = merge(val, schema);
        canonicalFor.set(s, { k: "record", key: alias, value: val });
        return;
      }
      default:
        return;
    }
  }

  walk(root, ROOT_CTX(rootName));
  return canonicalFor;
}
