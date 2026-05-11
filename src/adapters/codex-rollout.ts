import type { Adapter } from "./types"

/**
 * Stub. The default per-record path already handles Codex rollout JSONL
 * correctly; this adapter exists as a registration point for future
 * codex-specific transforms (e.g. event replay, tool-call coalescing).
 */
export const codexRolloutAdapter: Adapter = {
  name: "codex-rollout",
  detect() {
    return null
  },
}
