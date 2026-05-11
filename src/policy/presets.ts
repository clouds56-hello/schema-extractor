import type { MergePolicy } from "./types.js";

/**
 * Default policy used by the streaming `merge()` / `mergeIntoUnion()`.
 * Encodes the legacy invariant: two object IRs may merge iff their tag literals
 * (per TAG_CANDIDATES) agree.
 */
export const STREAM_MERGE_POLICY: MergePolicy = {
  combine: "deep",
  pick: "first",
  rules: [
    { gates: ["tag-present", "tag-strict"], similar: ["any"] },
    { gates: ["no-tag"], similar: ["alias-keys-compat"] },
    { gates: ["no-tag"], similar: ["subset-keys"] },
  ],
};

/** Hint pass: bucketing by (scope, namePrefix); shortest-name canonical. */
export const HINT_POLICY: MergePolicy = {
  combine: "deep",
  pick: "shortest-name",
  rules: [{ gates: ["tag-strict", "name-prefix"], similar: ["any"] }],
};

/**
 * Shallow combine — avoids unbounded recursion when bucket members reach each
 * other transitively (cycles through tag-shared substructure are common).
 */
export const TAG_HINT_POLICY: MergePolicy = {
  combine: "shallow",
  pick: "most-fields",
  rules: [{ gates: [], similar: ["any"] }],
};

export const AUTO_RECURSIVE_POLICY: MergePolicy = {
  combine: "deep",
  pick: "shortest-name",
  rules: [{ gates: ["tag-strict"], similar: ["any"] }],
};

/** Phase 1c: inline tagged objects shallow-extend into the existing hoisted IR with the same tag. */
export const INLINE_VS_HOISTED_POLICY: MergePolicy = {
  combine: "shallow",
  pick: "first",
  rules: [
    { gates: ["tag-strict"], similar: [{ kind: "overlap-min", n: 2 }, "subset-keys", { kind: "keys-lt", n: 5 }] },
    { gates: ["tag-strict"], similar: [{ kind: "overlap-min", n: 3 }] },
  ],
};

export const INLINE_INLINE_POLICY: MergePolicy = {
  combine: "shallow",
  pick: "most-fields",
  rules: [
    { gates: ["tag-strict"], similar: [{ kind: "overlap-min", n: 2 }, "subset-keys", { kind: "keys-lt", n: 5 }] },
    { gates: ["tag-strict"], similar: [{ kind: "overlap-min", n: 3 }] },
  ],
};

export const INLINE_SAMEKEYS_POLICY: MergePolicy = {
  combine: "deep-safe",
  pick: "most-fields",
  rules: [
    { gates: ["no-tag"], similar: ["same-keys", { kind: "keys-gt", n: 3 }, "types-match"] },
  ],
};
