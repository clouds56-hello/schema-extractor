// IR types — the discriminated union we build from JSON values and merge across records.
//
// `k` is intentionally one character because it appears in every node and the rendered
// debug output of a real schema is enormous.

export type Prim = "string" | "number" | "boolean" | "null";

export type Schema =
  | { k: "never" }
  | { k: "any" }
  | {
      k: "prim";
      types: Set<Prim>;
      literals?: Set<string>;          // string-literal tag values
      numLiterals?: Set<number>;       // numeric-literal tag values
      // String-aggregate fields (only meaningful when 'string' ∈ types):
      seenString?: boolean;
      aliasOnly?: Map<string, boolean>;       // AND-merged: every observed string matches this alias
      aliasEvidence?: Map<string, boolean>;   // OR-merged extra evidence (e.g. saw a base64 trailing '=')
      minLen?: number;
    }
  | { k: "array"; item: Schema }
  | { k: "object"; total: number; props: Map<string, { schema: Schema; present: number }> }
  | { k: "record"; key: string; value: Schema }   // map; `key` is alias name ("Path", "Uuid", or "string")
  | { k: "union"; variants: Schema[] };

export const NEVER: Schema = { k: "never" };

/**
 * Keys that, when present on an object, are treated as discriminator candidates for tagged unions.
 * The order is checked sequentially in `pickTagLiteral`.
 */
export const TAG_CANDIDATES = ["type", "kind", "tag", "role", "$type", "$mid", "event", "op"] as const;
export type TagCandidate = typeof TAG_CANDIDATES[number];
