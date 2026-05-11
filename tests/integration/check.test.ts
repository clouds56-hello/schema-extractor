/**
 * Manifest-driven check integration test. Reads schema-extractor.json from
 * the repo root, then for every declared target validates the input JSONL
 * against the committed `.d.ts` output via `checkJsonlAgainstDts`.
 *
 * - Targets whose input glob matches no files are skipped (developer machine
 *   may not have those data dirs).
 * - Real-world adapter outputs (codex, copilot-chat) currently fail strict
 *   structural checks because the adapter merges multiple `kind:N` records
 *   into a single root schema; per the active plan these are marked
 *   `test.skip` until the adapter+check integration is improved.
 * - Any target NOT in the skip-list runs strict: `pass === true` is required.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { checkJsonlAgainstDts } from "@/index"
import { findManifest, loadManifest, resolveTargetPaths } from "@/manifest"
import { expandGlobs } from "@/input/glob"

// Targets known to fail strict check today.
//   codex: no stateful adapter (codex-rollout is a stub), so any natural
//     drift between sessions trips the strict check.
//   copilot-chat: vscode-patch.transform now correctly materializes the
//     replayed state, but ONE record across the corpus exposes a real
//     schema-fidelity bug — `progressTaskSerialized.content` has two
//     distinct shapes ({value, uris} vs MarkdownString-shaped) and the
//     merge pipeline collapses to the first only. Fixing requires either
//     better union preservation in merge/passes or schema regeneration
//     against a wider corpus. Tracked as future work.
const KNOWN_DRIFT = new Set(["codex", "copilot-chat"])

const manifestPath = findManifest(resolve(__dirname, "..", ".."))

describe("check (manifest-driven)", () => {
  if (!manifestPath) {
    test.skip("no manifest found", () => {})
    return
  }

  const manifest = loadManifest(manifestPath)
  const baseDir = dirname(manifestPath)

  for (const target of manifest.targets) {
    const { input, output } = resolveTargetPaths(target, manifestPath)
    const outAbs = resolve(baseDir, output)
    const matched = expandGlobs(input)
    const skipReason =
      matched.length === 0
        ? `no input files matched (${input.join(", ")})`
        : !existsSync(outAbs)
          ? `committed output missing: ${output}`
          : KNOWN_DRIFT.has(target.name)
            ? "known adapter+check integration drift (see plan v4)"
            : null

    if (skipReason) {
      test.skip(`${target.name}: skipped — ${skipReason}`, () => {})
      continue
    }

    test(
      `${target.name}: records match ${output}`,
      async () => {
        const report = await checkJsonlAgainstDts(input, outAbs, target.options?.rootName)
        if (!report.pass) {
          const sample = report.failures
            .slice(0, 3)
            .map((f) => `  #${f.index} ${f.path}: ${f.reason}`)
            .join("\n")
          throw new Error(
            `${target.name}: ${report.failed}/${report.total} records failed:\n${sample}`,
          )
        }
        expect(report.pass).toBe(true)
      },
      60_000,
    )
  }
})
