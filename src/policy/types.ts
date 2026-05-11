// Merge policy taxonomy.
//
// A `MergePolicy` declares how a phase unifies object IRs. It composes four
// orthogonal axes:
//   - combine:  HOW values are merged into the canonical IR
//   - gates:    OUTER admission tests (tag overlap, naming, scope) — AND-composed
//   - similar:  INNER admission tests (field-set / value compatibility) — AND-composed
//   - pick:     WHICH member of a group becomes canonical
//
// A pair is admitted by a policy if ANY of its `rules` matches (OR over rules);
// each rule requires ALL of its gates AND ALL of its similars (AND within a rule).

export type CombineKind =
  | "deep"          // recurse into values; cycle-unsafe; calls into ir/merge
  | "deep-safe"     // recurse with cycle guards; preserves nested structure
  | "shallow"       // top-level field union; cycle-safe
  | "structural"    // identical bodies only — no mutation
  | "rename-only";  // share a name; keep distinct shapes

export type GateKind =
  | "any"
  | "tag-strict"    // tag literals overlap on every TAG_CANDIDATES key
  | "tag-present"   // both sides expose at least one TAG_CANDIDATES key with literal value
  | "tag-loose"     // same primary (tagKey, tagValue)
  | "no-tag"        // neither side has any TAG_CANDIDATES (or USER_TAG_KEY) field
  | "name-prefix";  // bucketing-time only; pairwise call always passes

export type SimilarKind =
  | "any"
  | "same-keys"
  | "subset-keys"
  | "alias-keys-compat"
  | { kind: "overlap-min"; n: number }
  | { kind: "keys-lt"; n: number }
  | { kind: "keys-gt"; n: number }
  | "types-match"
  | "nullable-compat";

export type PickerKind =
  | "first"
  | "most-fields"
  | "shortest-name"
  | "highest-occur"
  | "max-overlap";

export interface MergeRule {
  gates: GateKind[];
  similar: SimilarKind[];
}

export interface MergePolicy {
  combine: CombineKind;
  pick: PickerKind;
  rules: MergeRule[];
}
