# schema-extractor

Extract TypeScript schemas from JSON / JSONL streams (incl. gzipped, incl. VS Code patch logs).

```
bun run cli -- --name CodexSession --out examples/codex.d.ts '~/.codex/sessions/**/*.jsonl'
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
schema-extractor [--out PATH] [--name ROOT] [--tag KEY] [--no-adapters] [files...]
```

If no files are given, reads JSONL from stdin. `.gz` / `.gzip` files auto-decompress. File arguments support glob patterns (e.g. `'~/.codex/sessions/**/*.jsonl'`).

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
