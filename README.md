# schema-extractor

Extract TypeScript schemas from JSON / JSONL streams (incl. gzipped, incl. VS Code patch logs).

```
bun run cli -- gen --name CodexSession --out examples/codex.d.ts '~/.codex/sessions/**/*.jsonl'
```

Or programmatically:

```ts
import { extractSchemaFromFiles } from "schema-extractor"

const ts = await extractSchemaFromFiles(["~/.codex/sessions/**/*.jsonl"], {
  rootName: "CodexSession",
})
await Bun.write("codex.d.ts", ts)
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

### `gen` modes

- **manifest** (no args): reads `schema-extractor.json` (walked up from CWD; override with `--config <path>`) and builds every declared target into its `output` path. Use this for committed regeneration.
- **stdin** (`gen -`): reads JSONL from stdin, writes `.d.ts` to stdout. Useful for one-offs and pipelines.
- **explicit files** (`gen file.jsonl ...`): reads from given globs (`~` supported, `.gz` auto-decompressed) and writes to stdout (or `--out PATH`).

Per-file progress lines (`[file] processed N records`) are written to stderr; pass `-q` / `--quiet` to suppress them.

### `check` modes

- **manifest** (no args): reads `schema-extractor.json` and checks every target's input glob against its committed output `.d.ts`. Exits non-zero if any target has at least one validation failure (or matches no files).
- **explicit** (`check --schema <path> files...`): validates files against a single `.d.ts`.

For each input file `check` prints `[file] OK N/M` or `[file] FAIL k/M (first failure reason)`. Pass `-q` / `--quiet` to suppress per-file lines (only the summary remains). Use `--detail` to add per-field instance counts to the summary.

Run any subcommand with `--help` for its full options.

### Manifest (`schema-extractor.json`)

```json
{
  "targets": [
    {
      "name": "codex",
      "input": "~/.codex/sessions/**/*.jsonl",
      "output": "examples/codex.d.ts",
      "options": { "rootName": "CodexRollout" }
    }
  ]
}
```

CLI flags override per-target `options` which override built-in defaults. Schema in [`schema-extractor.schema.json`](./schema-extractor.schema.json) (draft-07).

## API

```ts
import {
  extractSchema,           // values: Iterable<unknown> -> string
  extractSchemaFromFiles,  // patterns: string[] -> Promise<string>
  extractSchemaFromStream, // ReadableStream<Uint8Array> -> Promise<string>
  checkJsonlAgainstDts,    // patterns + .d.ts path -> Promise<CheckReport>
  checkRecords,            // values: unknown[] + Schema -> CheckReport
  formatReport,
  mergeReport,             // aggregate per-file reports
  parseDts,                // .d.ts source -> { decls, order }
  simplifyDts,             // .d.ts source -> .d.ts source
  type ExtractorOptions,
  type CheckReport,
  type Schema,
  type Adapter,
  DEFAULT_ADAPTERS,
  vscodePatchAdapter,
  codexRolloutAdapter,
} from "schema-extractor"
```

`extractSchemaFromFiles` and `checkJsonlAgainstDts` accept an optional `onFile` callback for programmatic per-file progress (when present, the default stderr logging is suppressed).

## Tests

```
bun test                    # run all tests
bun run test:update         # refresh golden snapshots (UPDATE_GOLDEN=1 bun test)
bun run ci                  # typecheck + lint + test
```

Add a new regression case by dropping `tests/golden/cases/<NN>-<name>.case.ts`, then `bun run test:update`, then commit the produced `tests/golden/expected/<name>.d.ts`.

## Bench

```
bun run bench
```

Walks `schema-extractor.json`, runs `gen` and `check` for each target, prints throughput (records/sec, ms/file).

## Examples

Pre-generated schemas live in [`examples/`](./examples). Rebuild via the manifest at the repo root:

```
bun run regen:examples
```

## Contributing

This repo uses **Conventional Commits** (`feat fix chore test docs refactor style perf build ci revert`) with subjects ≤72 chars. Hooks live in `.githooks/` and are activated via `core.hooksPath`:

```
git config core.hooksPath .githooks
```

- `commit-msg` enforces the commit format.
- `pre-commit` runs `bun run typecheck` + `bun run lint`.

CI runs the same checks plus `bun test` on push/PR to `main` (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

## License

[MIT](./LICENSE)
