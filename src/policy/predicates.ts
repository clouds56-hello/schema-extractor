import type { Schema } from "@/ir/types"
import { gateAccepts } from "./gates"
import { similarAccepts } from "./similar"
import type { MergePolicy } from "./types"

export function policyAccepts(a: Schema, b: Schema, policy: MergePolicy): boolean {
  return policy.rules.some(
    (r) => r.gates.every((g) => gateAccepts(a, b, g)) && r.similar.every((s) => similarAccepts(a, b, s)),
  )
}
