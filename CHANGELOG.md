# Changelog

All notable changes to this project will be documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Build pipeline (`scripts/build.ts` + `tsconfig.build.json`): bundles each public entrypoint with `Bun.build` (target: `bun`, format: `esm`) into `dist/` with `@/*` aliases resolved at build time, then emits `.d.ts` declarations via `tsc` and rewrites alias paths in declarations via `tsc-alias`. Bin (`dist/bin/schema-extractor.js`) preserves its `#!/usr/bin/env bun` shebang and is marked executable. Triggered by `bun run build` and automatically by `prepublishOnly`.
- `.github/workflows/release.yml`: publishes the package to npm with `--access public --provenance` when a `v*` tag passes CI. Verifies the tag matches `package.json` version before publishing. Requires repo secret `NPM_TOKEN`.
- `package.json` now points `main` / `module` / `types` / `exports` / `bin` at `dist/`, drops `src` and `bin` from `files` (replaced by `dist`).
- CI runs on `v*` tag pushes too so the release workflow has a `workflow_run` trigger to depend on.

## [0.1.1] - 2026-05-11

### Added
- `structural-dedupe` pipeline pass (`src/passes/structural-dedupe.ts`): collapses shape-equivalent hoisted objects — most visibly the unrolled-recursive `Children_1_*` chains in `examples/copilot-chat.d.ts`, where 5 distinct decls fold into a single self-recursive type. Iterates with `rewriteIR` between passes (cap 16) and uses shallow per-prop merging (`merge()` for prim×prim, reference + `dryRender`-equivalence dedupe for unions) to avoid traversing cyclic IR.
- Golden case `tests/golden/cases/11-recursive-chain-collapse.case.ts` exercising the unrolled-recursive collapse end-to-end.
- `--quiet` / `-q` flag for `gen` and `check` to suppress per-file progress logs.
- Per-file progress lines for `check`: `[file] OK N/M` or `[file] FAIL k/M (reason)`.
- `mergeReport(into, add)` in `src/check/index.ts` for aggregating per-file `CheckReport`s while preserving the global 20-failure cap.
- `onFile` callback parameter on `extractSchemaFromFiles` and `checkJsonlAgainstDts` for programmatic per-file progress.
- `scripts/bench.ts` + `bun run bench` script: walks the manifest, times `gen` and `check` per target, prints throughput (records/sec, ms/file).
- `.githooks/pre-commit` running `bun run typecheck` + `bun run lint` (active via existing `core.hooksPath=.githooks`).
- `.github/workflows/ci.yml` running typecheck/lint/test on push and PR to `main`.
- `LICENSE` (MIT) + `repository`, `homepage`, `bugs`, `keywords`, `author`, `files` fields in `package.json` for npm publishing.
- `pack:dry` script (`npm pack --dry-run`) for verifying the publish tarball contents.
- Unit test `tests/unit/shallow-combine.test.ts` covering the v7 shallow-combine regression.
- Golden case `tests/golden/cases/10-tag-divergent-content.case.ts` covering the same regression at the document level.
- `Adapter.transform?(records)` interface: optional record materialiser used by `check` so validation runs against the same logical records the schema was generated from. `vscode-patch.transform` returns `[state]`.
- `check` subcommand: validates JSONL against an emitted `.d.ts`. Manifest-mode (no args) and explicit-mode (`--schema <path> files...`).
- `simplify` subcommand: re-emits an existing `.d.ts` through the simplification pipeline.
- `schema-extractor.json` manifest + `schema-extractor.schema.json` (draft-07) and walk-up discovery via `findManifest()`.

### Changed
- `combineInto` `case "shallow"` (in `src/policy/combine.ts`) now deep-merges non-prim props with structurally different incoming schemas via cycle-safe `mergeDeepSafe`, instead of silently keeping the first-seen shape. Restores the divergent `progressTaskSerialized.content` union in `examples/copilot-chat.d.ts`.
- `check` union dispatch dropped the per-variant snapshot/restore of stats Maps; uses `pickTagDispatch` fast path for tag-discriminated objects and best-attempt error messaging otherwise. Turns O(stats_size × union_depth) into O(1) per try; full 65-file copilot-chat strict check now finishes in ~7s (previously hung past 120s).

### Fixed
- `expandGlobs` no longer throws `ENOENT` when a glob's prefix directory is absent (e.g. `~/.codex/sessions/**/*.jsonl` on a fresh CI runner). Missing prefixes now produce the same "no files matched" warning + empty result that the integration tests rely on for skip-on-no-matches behaviour. Adds `tests/unit/glob.test.ts`.
- `examples/copilot-chat.d.ts` regenerated with the restored `Content_Variant_… | Content_Variant_…_2` union for `progressTaskSerialized.content`.
- `tests/integration/check.test.ts` `KNOWN_DRIFT` reduced to `["codex"]` — copilot-chat now passes strict validation end-to-end.

## [0.1.0] - initial

- Initial extraction from the monolithic `old/extract-jsonl-schema.ts` into the modular library laid out under `src/{ir,policy,passes,emit,input,adapters,parse-dts,check}` plus `src/{config,index,cli,manifest,runtime}.ts`.
- CLI subcommands: `gen` (default), `check`, `simplify`.
- Public API: `extractSchema`, `extractSchemaFromStream`, `extractSchemaFromFiles`, `simplifyDts`, `checkJsonlAgainstDts`, `checkRecords`, `formatReport`, `parseDts`.
- Bundled adapters: `vscodePatchAdapter`, `codexRolloutAdapter`.
- Golden test framework (`tests/golden/`) and unit suite under `tests/unit/`.
- Committed sample outputs `examples/codex.d.ts` and `examples/copilot-chat.d.ts`.
