import { describe, expect, test } from "bun:test"
import { extractSchemaFromFiles } from "@/index"
import { expandGlobs } from "@/input/glob"

const cases = [
  {
    name: "codex",
    glob: "~/.codex/sessions/**/*.jsonl",
    options: { rootName: "CodexRollout" },
    expected: "examples/codex.d.ts",
  },
  {
    name: "copilot-chat",
    glob: "~/.local/share/workspaceStorage/*/chatSessions/*.jsonl",
    options: { rootName: "CopilotChat" },
    expected: "examples/copilot-chat.d.ts",
  },
] as const

describe("examples regression", () => {
  for (const c of cases) {
    const matches = expandGlobs([c.glob])
    if (matches.length === 0) {
      test.skip(`${c.name}: no source files (skipped)`, () => {})
      continue
    }
    test(
      `${c.name}: matches committed snapshot`,
      async () => {
        const fresh = await extractSchemaFromFiles([c.glob], c.options)
        const committed = await Bun.file(c.expected).text()
        if (fresh !== committed) {
          throw new Error(
            `${c.expected} drifted from generator output. Run \`bun run regen:examples\` to refresh.`,
          )
        }
        expect(fresh).toBe(committed)
      },
      60_000,
    )
  }
})
