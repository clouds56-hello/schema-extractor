import { extractSchemaFromFiles, extractSchemaFromStream, DEFAULT_ADAPTERS } from "./index.js";
import type { ExtractorOptions } from "./config.js";

interface CliArgs {
  out: string | null;
  name: string;
  tag: string | null;
  noAdapters: boolean;
  hint: Array<readonly [string, string]>;
  recordHint: string[];
  multiTagHint: string[];
  files: string[];
}

function printHelp(): void {
  process.stdout.write(
    `Usage: schema-extractor [options] [files...]\n` +
      `\n` +
      `Reads JSONL from files (globs + ~ supported, .gz auto-decompressed) or stdin\n` +
      `and prints a TypeScript .d.ts to stdout (or --out <path>).\n` +
      `\n` +
      `Options:\n` +
      `  --out <path>          Write to file instead of stdout\n` +
      `  --name <Root>         Root type name (default: Root)\n` +
      `  --tag <key>           Extra discriminator key\n` +
      `  --no-adapters         Disable file-shape adapters (vscode-patch, ...)\n` +
      `  --hint <Scope:Name>   Add a dedup hint (repeatable). Format: "ScopePrefix:NamePrefix"\n` +
      `  --record-hint <Seg>   Add a record-collapse hint (repeatable)\n` +
      `  --multi-tag <Key>     Add a global-tag hint (repeatable)\n` +
      `  -h, --help            Show this help\n`,
  );
}

function parseArgs(argv: readonly string[]): CliArgs {
  const a: CliArgs = {
    out: null,
    name: "Root",
    tag: null,
    noAdapters: false,
    hint: [],
    recordHint: [],
    multiTagHint: [],
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x === "--out") a.out = argv[++i] ?? null;
    else if (x === "--name") a.name = argv[++i] ?? "Root";
    else if (x === "--tag") a.tag = argv[++i] ?? null;
    else if (x === "--no-adapters") a.noAdapters = true;
    else if (x === "--hint") {
      const v = argv[++i] ?? "";
      const idx = v.indexOf(":");
      if (idx <= 0) {
        console.error(`--hint expects "ScopePrefix:NamePrefix", got: ${v}`);
        process.exit(2);
      }
      a.hint.push([v.slice(0, idx), v.slice(idx + 1)] as const);
    } else if (x === "--record-hint") a.recordHint.push(argv[++i] ?? "");
    else if (x === "--multi-tag") a.multiTagHint.push(argv[++i] ?? "");
    else if (x === "-h" || x === "--help") {
      printHelp();
      process.exit(0);
    } else if (x.startsWith("--")) {
      console.error(`unknown flag: ${x}`);
      process.exit(2);
    } else a.files.push(x);
  }
  return a;
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const opts: ExtractorOptions = {
    rootName: args.name,
    userTagKey: args.tag,
    adapters: args.noAdapters ? [] : DEFAULT_ADAPTERS,
  };
  if (args.hint.length) opts.dedupHints = args.hint;
  if (args.recordHint.length) opts.recordHints = args.recordHint;
  if (args.multiTagHint.length) opts.multiTagHints = args.multiTagHint;

  let ts: string;
  if (args.files.length === 0) {
    const { Readable } = await import("node:stream");
    const webStream = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
    ts = await extractSchemaFromStream(webStream, opts, "<stdin>");
  } else {
    ts = await extractSchemaFromFiles(args.files, opts);
  }

  if (args.out) {
    // @ts-ignore - Bun global
    await Bun.write(args.out, ts);
    console.error(`wrote ${args.out}`);
  } else {
    process.stdout.write(ts);
  }
}
