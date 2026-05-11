# schema-extractor

Extract TypeScript schemas from JSON / JSONL streams (incl. gzipped, incl. VS Code patch logs).

```
bun run cli -- gen --name CodexSession --out examples/codex.d.ts '~/.codex/sessions/**/*.jsonl'
```

Or programmatically:

```ts
import { extractSchemaFromFiles } from "schema-extractor";

const ts = await extractSchemaFromFiles(["~/.codex/sessions/**/*.jsonl"], {
  rootName: "CodexSession",
});
await Bun.write("codex.d.ts", ts);
```

See [`goal.md`](./goal.md) for scope and [`agents.md`](./agents.md) for architecture.

## CLI

```
schema-extractor <command> [options]

Commands:
  gen        Extract a .d.ts schema from JSONL inputs
  check      Validate JSONL records against an existing .d.ts schema
  simplify   Re-run the simplification pipeline on an existing .d.ts
```

`gen` reads JSONL from files (globs + `~` supported, `.gz` auto-decompressed) or stdin and writes a `.d.ts` to stdout (or `--out PATH`). Run any subcommand with `--help` for its options.

## API

```ts
import {
  extractSchema,           // values: unknown[] -> string
  extractSchemaFromFiles,  // patterns: string[] -> Promise<string>
  extractSchemaFromStream, // ReadableStream<Uint8Array> -> Promise<string>
  type ExtractorOptions,
} from "schema-extractor";
```

## Tests

```
bun test                    # run all tests
UPDATE_GOLDEN=1 bun test    # refresh golden snapshots
```

Add a new regression case by dropping `tests/golden/cases/<name>/input.jsonl` (and optionally `options.json`), then `UPDATE_GOLDEN=1 bun test`, then commit the produced `expected.d.ts`.

## Examples

Pre-generated schemas live in [`examples/`](./examples). Rebuild with:

```
bun run regen:examples
```
