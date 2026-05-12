import type { ExtractorOptions } from "./config"
import {
  checkJsonlAgainstDts,
  DEFAULT_ADAPTERS,
  extractSchemaFromFiles,
  extractSchemaFromStream,
  formatReport,
  simplifyDts,
} from "./index"
import { findManifest, loadManifest, type Manifest, resolveTargetPaths, type Target } from "./manifest"
import { setPipelineTrace } from "./runtime"

interface GenArgs {
  out: string | null
  name: string | null
  tag: string | null
  noAdapters: boolean
  hint: Array<readonly [string, string]>
  recordHint: string[]
  multiTagHint: string[]
  files: string[]
  configPath: string | null
  stdin: boolean
  quiet: boolean
  tracePipeline: boolean
}

function printRootHelp(): void {
  process.stdout.write(
    `Usage: schema-extractor <command> [options]

Commands:
  gen        Extract a .d.ts schema from JSONL inputs (default behavior)
  check      Validate JSONL records against an existing .d.ts schema
  simplify   Re-run the simplification pipeline on an existing .d.ts

Use \`schema-extractor <command> --help\` for command-specific options.
`,
  )
}

function printGenHelp(): void {
  process.stdout.write(
    `Usage: schema-extractor gen [options] [files... | -]

Modes:
  no args              Read schema-extractor.json (walked up from CWD) and
                       build every target into its declared output path.
  -                    Read JSONL from stdin and print to stdout.
  files...             Read explicit files/globs (~ + ** supported, .gz ok)
                       and print to stdout (or --out <path>).

Options:
  --config <path>       Use a specific manifest (overrides walk-up discovery)
  --out <path>          Write to file instead of stdout (single-target modes)
  --name <Root>         Root type name (default: Root, or per-target in manifest)
  --tag <key>           Extra discriminator key
  --no-adapters         Disable file-shape adapters (vscode-patch, ...)
  --hint <Scope:Name>   Add a dedup hint (repeatable). Format: "ScopePrefix:NamePrefix"
  --record-hint <Seg>   Add a record-collapse hint (repeatable)
  --multi-tag <Key>     Add a global-tag hint (repeatable)
  --trace-pipeline      Log per-phase timings + rewrite counts to stderr
  -q, --quiet           Suppress per-file progress logs
  -h, --help            Show this help
`,
  )
}

function printCheckHelp(): void {
  process.stdout.write(
    `Usage:
  schema-extractor check                                  (manifest mode)
  schema-extractor check --schema <path> [opts] files...  (explicit mode)

Modes:
  no args              Read schema-extractor.json (walked up from CWD; or
                       --config <path>) and check every target's input
                       against its committed output. Exits nonzero if any
                       target has at least one validation failure or if any
                       target's input glob matches no files.
  explicit             Validate JSONL files against a single .d.ts schema.

Options:
  --config <path>       Manifest path (overrides walk-up discovery)
  --schema <path>       Path to .d.ts schema (required for explicit mode)
  --root <Name>         Which exported type to validate against (default: last)
  --detail              Also print per-field instance counts
  -q, --quiet           Suppress per-file progress logs (only summary)
  -h, --help            Show this help

Exit codes: 0 = all checks pass, 1 = at least one validation failure.
`,
  )
}

function printSimplifyHelp(): void {
  process.stdout.write(
    `Usage: schema-extractor simplify --in <path> [options]

Parse an existing .d.ts, run it through the simplification pipeline
(record-detection, dedup, alias collapse), and emit a cleaner .d.ts.

Options:
  --in <path>           Input .d.ts (required)
  --out <path>          Output path (default: stdout)
  --name <Root>         Override root type name
  -h, --help            Show this help
`,
  )
}

function parseGenArgs(argv: readonly string[]): GenArgs {
  const a: GenArgs = {
    out: null,
    name: null,
    tag: null,
    noAdapters: false,
    hint: [],
    recordHint: [],
    multiTagHint: [],
    files: [],
    configPath: null,
    stdin: false,
    quiet: false,
    tracePipeline: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!
    if (x === "-") a.stdin = true
    else if (x === "--config") a.configPath = argv[++i] ?? null
    else if (x === "--out") a.out = argv[++i] ?? null
    else if (x === "--name") a.name = argv[++i] ?? null
    else if (x === "--tag") a.tag = argv[++i] ?? null
    else if (x === "--no-adapters") a.noAdapters = true
    else if (x === "-q" || x === "--quiet") a.quiet = true
    else if (x === "--trace-pipeline") a.tracePipeline = true
    else if (x === "--hint") {
      const v = argv[++i] ?? ""
      const idx = v.indexOf(":")
      if (idx <= 0) {
        console.error(`--hint expects "ScopePrefix:NamePrefix", got: ${v}`)
        process.exit(2)
      }
      a.hint.push([v.slice(0, idx), v.slice(idx + 1)] as const)
    } else if (x === "--record-hint") a.recordHint.push(argv[++i] ?? "")
    else if (x === "--multi-tag") a.multiTagHint.push(argv[++i] ?? "")
    else if (x === "-h" || x === "--help") {
      printGenHelp()
      process.exit(0)
    } else if (x.startsWith("--")) {
      console.error(`unknown flag: ${x}`)
      process.exit(2)
    } else a.files.push(x)
  }
  return a
}

/** Build ExtractorOptions by layering: defaults < manifest target < CLI flags. */
function mergeOptions(targetOpts: ExtractorOptions | undefined, args: GenArgs): ExtractorOptions {
  const out: ExtractorOptions = { ...(targetOpts ?? {}) }
  if (args.name !== null) out.rootName = args.name
  if (args.tag !== null) out.userTagKey = args.tag
  if (args.noAdapters) out.adapters = []
  else if (out.adapters === undefined) out.adapters = DEFAULT_ADAPTERS
  if (args.hint.length) out.dedupHints = args.hint
  if (args.recordHint.length) out.recordHints = args.recordHint
  if (args.multiTagHint.length) out.multiTagHints = args.multiTagHint
  return out
}

async function buildTarget(target: Target, manifestPath: string, args: GenArgs): Promise<void> {
  const { input, output } = resolveTargetPaths(target, manifestPath)
  const opts = mergeOptions(target.options, args)
  const onFile = args.quiet
    ? undefined
    : (f: string, n: number) => console.error(`[${target.name}] [${f}] processed ${n} records`)
  const ts = await extractSchemaFromFiles(input, opts, onFile)
  await Bun.write(output, ts)
  console.error(`[${target.name}] wrote ${output}`)
}

async function buildFromManifest(args: GenArgs): Promise<void> {
  const manifestPath = args.configPath ?? findManifest()
  if (!manifestPath) {
    console.error(
      "gen: no input. Provide files, pipe stdin via `gen -`, or create schema-extractor.json.",
    )
    process.exit(2)
  }
  const manifest: Manifest = loadManifest(manifestPath)
  if (manifest.targets.length === 0) {
    console.error(`gen: manifest at ${manifestPath} has no targets`)
    process.exit(2)
  }
  for (const t of manifest.targets) {
    await buildTarget(t, manifestPath, args)
  }
}

async function cmdGen(argv: readonly string[]): Promise<void> {
  const args = parseGenArgs(argv)
  if (args.tracePipeline) setPipelineTrace(true)

  // No positional args and no `-` → manifest-driven build.
  if (!args.stdin && args.files.length === 0) {
    await buildFromManifest(args)
    return
  }

  const opts = mergeOptions(undefined, args)
  if (opts.rootName === undefined) opts.rootName = "Root"

  let ts: string
  if (args.stdin) {
    const { Readable } = await import("node:stream")
    const webStream = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
    ts = await extractSchemaFromStream(webStream, opts, "<stdin>")
  } else {
    const onFile = args.quiet
      ? undefined
      : (f: string, n: number) => console.error(`[${f}] processed ${n} records`)
    ts = await extractSchemaFromFiles(args.files, opts, onFile)
  }

  if (args.out) {
    await Bun.write(args.out, ts)
    console.error(`wrote ${args.out}`)
  } else {
    process.stdout.write(ts)
  }
}

async function cmdCheck(argv: readonly string[]): Promise<void> {
  let schemaPath: string | null = null
  let rootName: string | null = null
  let detail = false
  let configPath: string | null = null
  let quiet = false
  const files: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!
    if (x === "--schema") schemaPath = argv[++i] ?? null
    else if (x === "--root") rootName = argv[++i] ?? null
    else if (x === "--detail") detail = true
    else if (x === "--config") configPath = argv[++i] ?? null
    else if (x === "-q" || x === "--quiet") quiet = true
    else if (x === "-h" || x === "--help") {
      printCheckHelp()
      return
    } else if (x.startsWith("--")) {
      console.error(`check: unknown flag ${x}`)
      process.exit(2)
    } else files.push(x)
  }

  const fileLogger = (prefix: string) => (f: string, r: import("./check/index").CheckReport) => {
    if (quiet) return
    const status = r.pass ? "OK" : "FAIL"
    const reason = r.pass ? "" : ` (${r.failures[0]?.reason ?? "unknown"})`
    process.stdout.write(`${prefix}[${f}] ${status} ${r.total - r.failed}/${r.total}${reason}\n`)
  }

  // Manifest mode: no --schema and no positional files.
  if (!schemaPath && files.length === 0) {
    const mfPath = configPath ?? findManifest()
    if (!mfPath) {
      console.error(
        "check: no input. Provide --schema + files, or create schema-extractor.json.",
      )
      process.exit(2)
    }
    const manifest = loadManifest(mfPath)
    if (manifest.targets.length === 0) {
      console.error(`check: manifest at ${mfPath} has no targets`)
      process.exit(2)
    }
    let anyFail = false
    for (const t of manifest.targets) {
      const { input, output } = resolveTargetPaths(t, mfPath)
      try {
        const report = await checkJsonlAgainstDts(
          input,
          output,
          t.options?.rootName,
          undefined,
          fileLogger(`[${t.name}] `),
        )
        const status = report.pass ? "OK" : "FAIL"
        process.stdout.write(`[${t.name}] ${status} ${report.total - report.failed}/${report.total}\n`)
        if (detail || !report.pass) process.stdout.write(formatReport(report, detail))
        if (!report.pass) anyFail = true
      } catch (e) {
        console.error(`[${t.name}] error: ${(e as Error).message}`)
        anyFail = true
      }
    }
    process.exit(anyFail ? 1 : 0)
  }

  if (!schemaPath) {
    console.error("check: --schema <path> is required when files are given")
    process.exit(2)
  }
  if (files.length === 0) {
    console.error("check: at least one input file or glob is required")
    process.exit(2)
  }
  const report = await checkJsonlAgainstDts(
    files,
    schemaPath,
    rootName ?? undefined,
    undefined,
    fileLogger(""),
  )
  process.stdout.write(formatReport(report, detail))
  process.exit(report.pass ? 0 : 1)
}

async function cmdSimplify(argv: readonly string[]): Promise<void> {
  let inPath: string | null = null
  let outPath: string | null = null
  let name: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!
    if (x === "--in") inPath = argv[++i] ?? null
    else if (x === "--out") outPath = argv[++i] ?? null
    else if (x === "--name") name = argv[++i] ?? null
    else if (x === "-h" || x === "--help") {
      printSimplifyHelp()
      return
    } else {
      console.error(`simplify: unknown arg ${x}`)
      process.exit(2)
    }
  }
  if (!inPath) {
    console.error("simplify: --in <path> is required")
    process.exit(2)
  }
  const src = await Bun.file(inPath).text()
  const opts: ExtractorOptions = {}
  if (name) opts.rootName = name
  const out = simplifyDts(src, opts)
  if (outPath) {
    await Bun.write(outPath, out)
    console.error(`wrote ${outPath}`)
  } else {
    process.stdout.write(out)
  }
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const subcmd = argv[0]
  const rest = argv.slice(1)
  switch (subcmd) {
    case "gen":
      return cmdGen(rest)
    case "check":
      if (rest[0] === "-h" || rest[0] === "--help") {
        printCheckHelp()
        return
      }
      return cmdCheck(rest)
    case "simplify":
      if (rest[0] === "-h" || rest[0] === "--help") {
        printSimplifyHelp()
        return
      }
      return cmdSimplify(rest)
    case "-h":
    case "--help":
    case undefined:
      printRootHelp()
      return
    default:
      console.error(`unknown command: ${subcmd}`)
      printRootHelp()
      process.exit(2)
  }
}
