import type { Schema } from "@/ir/types"
import type { MergePolicy } from "./types"
import { gateAccepts } from "./gates"
import { similarAccepts } from "./similar"

export function policyAccepts(a: Schema, b: Schema, policy: MergePolicy): boolean {
  return policy.rules.some(
    (r) => r.gates.every((g) => gateAccepts(a, b, g)) && r.similar.every((s) => similarAccepts(a, b, s)),
  )
}
