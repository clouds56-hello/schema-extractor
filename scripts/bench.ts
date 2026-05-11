#!/usr/bin/env bun
/**
 * Bench script: walk the manifest, time `gen` and `check` per target.
 * Prints throughput as records/sec and ms/file.
 *
 * Usage: bun scripts/bench.ts [--config path]
 */
import { checkJsonlAgainstDts, extractSchemaFromFiles } from "@/index"
import { findManifest, loadManifest, resolveTargetPaths } from "@/manifest"
import { expandGlobs } from "@/input/glob"
import { openSource, parseJsonl } from "@/input/jsonl"

function fmt(n: number, w = 8): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 }).padStart(w)
}

async function countRecords(files: readonly string[]): Promise<number> {
  let total = 0
  for (const f of files) total += (await parseJsonl(openSource(f), f)).length
  return total
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let cfg: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config") cfg = argv[++i] ?? null
  }
  const mfPath = cfg ?? findManifest()
  if (!mfPath) {
    console.error("bench: no schema-extractor.json found")
    process.exit(2)
  }
  const manifest = loadManifest(mfPath)
  console.log(`manifest: ${mfPath}`)
  console.log(
    `${"target".padEnd(16)} ${"files".padStart(6)} ${"records".padStart(9)} ${"gen ms".padStart(8)} ${"chk ms".padStart(8)} ${"rec/s".padStart(10)} ${"ms/file".padStart(8)}`,
  )
  for (const t of manifest.targets) {
    const { input, output } = resolveTargetPaths(t, mfPath)
    let files: string[]
    try {
      files = expandGlobs(input)
    } catch {
      console.log(`${t.name.padEnd(16)} (no input files)`)
      continue
    }
    if (files.length === 0) {
      console.log(`${t.name.padEnd(16)} (no input files)`)
      continue
    }
    const records = await countRecords(files)
    const t0 = performance.now()
    await extractSchemaFromFiles(input, t.options, () => {})
    const genMs = performance.now() - t0
    const t1 = performance.now()
    await checkJsonlAgainstDts(input, output, t.options?.rootName)
    const chkMs = performance.now() - t1
    const recPerSec = records / ((genMs + chkMs) / 1000)
    const msPerFile = (genMs + chkMs) / files.length
    console.log(
      `${t.name.padEnd(16)} ${fmt(files.length, 6)} ${fmt(records, 9)} ${fmt(genMs, 8)} ${fmt(chkMs, 8)} ${fmt(recPerSec, 10)} ${fmt(msPerFile, 8)}`,
    )
  }
}

await main()
