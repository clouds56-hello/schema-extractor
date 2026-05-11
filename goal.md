# goal.md — schema-extractor

## Mission
Given a stream of JSON or JSONL records (potentially huge, optionally gzipped, possibly representing a VS Code-style patch log), produce a single TypeScript declaration file that captures the observed schema with high fidelity and good readability.

## Primary use cases
1. **Reverse-engineering opaque session formats** — e.g. `~/.codex/sessions/**/*.jsonl`, `~/.local/share/workspaceStorage/**/chatSessions/*.jsonl`. Drop in a directory, get a `.d.ts`.
2. **Schema-drift regression** — re-run after vendor updates and diff the generated `.d.ts` to spot new variants.
3. **Programmatic exploration** — call the API from another script that wants to inspect or transform the IR before emitting.

## Non-goals
- JSON Schema (draft-7) emission. (Could be a future emitter; not v0.)
- Validating data against a known schema.
- Round-tripping (schema → sample). The IR is lossy by design.
- Streaming / incremental emit. We materialize an IR, then render once.

## Hard requirements
- **Both CLI and programmatic API** ship in v0.
- **Constant memory wrt input size** (line-streamed parsing; the IR itself grows with schema diversity, not record count).
- **Gzip** auto-detect via `.gz` / `.gzip`.
- **Glob expansion** for `~/...`, `**`, `*`, `?`, `[...]`, `{a,b}`.
- **Pluggable adapters** for input shapes that need replay (e.g. VS Code `kind:0/1/2` patch logs).
- **Pluggable passes** so callers can inject custom IR transforms before rendering.
- **Regression-test framework** that makes adding a new fixture trivial: drop a `.jsonl` + (optional) `options.json`, run with `UPDATE_GOLDEN=1`, commit the snapshot.
- **Sample schemas committed**: `examples/codex.d.ts`, `examples/copilot-chat.d.ts`. Re-built by `bun run regen:examples`.

## Quality bars
- All IR / policy / passes / emit code is pure (no I/O, no globals beyond a small `runtime` config object).
- I/O lives only in `src/input/`, `src/cli.ts`, `bin/`, `scripts/`.
- No runtime npm dependencies. Uses Bun built-ins (`Bun.file`, `Bun.Glob`) + `node:crypto` + Web `DecompressionStream`.
- `bunx tsc --noEmit` clean under `strict` + `noUncheckedIndexedAccess`.

## Schema fidelity goals (in priority order)
1. **Correct discrimination of tagged unions** (`type` / `kind` / `tag` / `role` / `$type` / `$mid` / `event` / `op` / user-supplied).
2. **String aliases** for recognizable formats (`Uuid`, `Sha256`, `Sha1`, `Semver`, `Email`, `IsoDate`, `Url`, `Path`, `Hex`, `Base64`, `VscodeCallId`).
3. **`Record<K,V>` collapse** for objects whose keys are all the same alias (e.g. all paths, all UUIDs).
4. **Recursive-type detection** — same `(field, tagKey, tagValue)` reachable from itself becomes one named type instead of an exploded chain.
5. **Inline-vs-hoisted unification** — the same shape appearing both as a union variant and inline as a field value collapses to one declaration.
6. **Structural dedupe** — identical bodies sharing a name prefix collapse to a single decl.

## Out of scope (for now, may revisit)
- Heuristics for numeric ranges (min/max/integer-only).
- Comment harvesting from sibling fields (`description`, `title`, etc.).
- Multiple emit targets (Zod, JSON Schema, Protobuf).
- Watching files / incremental rebuilds.
