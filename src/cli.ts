import type { ExtractorOptions } from "./config"
import {
  checkJsonlAgainstDts,
  DEFAULT_ADAPTERS,
  extractSchemaFromFiles,
  extractSchemaFromStream,
  formatReport,
  simplifyDts,
} from "./index"

interface GenArgs {
  out: string | null
  name: string
  tag: string | null
  noAdapters: boolean
  hint: Array<readonly [string, string]>
  recordHint: string[]
  multiTagHint: string[]
  files: string[]
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
    `Usage: schema-extractor gen [options] [files...]

Reads JSONL from files (globs + ~ supported, .gz auto-decompressed) or stdin
and prints a TypeScript .d.ts to stdout (or --out <path>).

Options:
  --out <path>          Write to file instead of stdout
  --name <Root>         Root type name (default: Root)
  --tag <key>           Extra discriminator key
  --no-adapters         Disable file-shape adapters (vscode-patch, ...)
  --hint <Scope:Name>   Add a dedup hint (repeatable). Format: "ScopePrefix:NamePrefix"
  --record-hint <Seg>   Add a record-collapse hint (repeatable)
  --multi-tag <Key>     Add a global-tag hint (repeatable)
  -h, --help            Show this help
`,
  )
}

function printCheckHelp(): void {
  process.stdout.write(
    `Usage: schema-extractor check --schema <path> [options] [files...]

Validate each JSONL record against a previously generated .d.ts schema.
Reports overall pass/fail plus per-type instance counts.

Options:
  --schema <path>       Path to .d.ts schema (required)
  --root <Name>         Which exported type to validate against (default: first)
  --detail              Also print per-field instance counts
  -h, --help            Show this help

Exit codes: 0 = all records valid, 1 = at least one validation failure.
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
    name: "Root",
    tag: null,
    noAdapters: false,
    hint: [],
    recordHint: [],
    multiTagHint: [],
    files: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!
    if (x === "--out") a.out = argv[++i] ?? null
    else if (x === "--name") a.name = argv[++i] ?? "Root"
    else if (x === "--tag") a.tag = argv[++i] ?? null
    else if (x === "--no-adapters") a.noAdapters = true
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

async function cmdGen(argv: readonly string[]): Promise<void> {
  const args = parseGenArgs(argv)
  const opts: ExtractorOptions = {
    rootName: args.name,
    userTagKey: args.tag,
    adapters: args.noAdapters ? [] : DEFAULT_ADAPTERS,
  }
  if (args.hint.length) opts.dedupHints = args.hint
  if (args.recordHint.length) opts.recordHints = args.recordHint
  if (args.multiTagHint.length) opts.multiTagHints = args.multiTagHint

  let ts: string
  if (args.files.length === 0) {
    const { Readable } = await import("node:stream")
    const webStream = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
    ts = await extractSchemaFromStream(webStream, opts, "<stdin>")
  } else {
    ts = await extractSchemaFromFiles(args.files, opts)
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
  const files: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!
    if (x === "--schema") schemaPath = argv[++i] ?? null
    else if (x === "--root") rootName = argv[++i] ?? null
    else if (x === "--detail") detail = true
    else if (x === "-h" || x === "--help") {
      printCheckHelp()
      return
    } else if (x.startsWith("--")) {
      console.error(`check: unknown flag ${x}`)
      process.exit(2)
    } else files.push(x)
  }
  if (!schemaPath) {
    console.error("check: --schema <path> is required")
    process.exit(2)
  }
  if (files.length === 0) {
    console.error("check: at least one input file or glob is required")
    process.exit(2)
  }
  const report = await checkJsonlAgainstDts(files, schemaPath, rootName ?? undefined)
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
