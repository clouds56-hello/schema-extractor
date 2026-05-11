import type { Schema } from "../ir/types.js";
import type { MergePolicy } from "./types.js";
import { gateAccepts } from "./gates.js";
import { similarAccepts } from "./similar.js";

export function policyAccepts(a: Schema, b: Schema, policy: MergePolicy): boolean {
  return policy.rules.some((r) =>
    r.gates.every((g) => gateAccepts(a, b, g)) &&
    r.similar.every((s) => similarAccepts(a, b, s)),
  );
}
