# Changelog

All notable changes to this project will be documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Copilot CLI example target for `~/.copilot/session-state/*/events.jsonl`, generating `examples/copilot-cli.d.ts` via the manifest.
- Plugin-provided string aliases through `PluginContribution.stringAliases`; aliases participate in primitive string rendering, record key detection, and emitted alias declarations.
- Bundled `copilotCliPlugin` with a conservative `ModelId` alias and a keyed `modelMetrics` record hint so Copilot CLI model metrics emit as `Record<ModelId, ...>`.
- Golden regression covering plugin string aliases, `modelMetrics` record collapse, and quoted literal fields like `"system-reminder"`.

### Changed
- Record hints now match the current field/path segment instead of broad substring matches across the full generated name chain, avoiding accidental recordification from tag/literal-derived path text.
- `recordHints` can now be either legacy string hints (`Record<string, V>`) or keyed hints (`{ field, key }`) for plugin-controlled record key aliases.

### Fixed
- Copilot CLI `modelMetrics` no longer emits one property per observed model ID such as `"glm-4.7"`; it emits `Record<ModelId, ...>`.
- Prevented invalid record key aliases such as `Record<system-reminder, ...>` from broad record-hint matching.

## [0.1.4] - 2026-05-13

### Added
- Explicit `Phase` framework in `src/passes/pipeline.ts`: each pass declares `name`, `loop`, `prunesHoists`, `emitsHoists`. `PIPELINE_PHASE_NAMES` and `PIPELINE_LOOP_PHASE_NAMES` exports lock the canonical order so accidental reshuffles trip a fast unit test before the goldens diff.
- `--trace-pipeline` CLI flag + `setPipelineTrace()` runtime toggle: per-phase timings + rewrite counts logged to stderr, including iteration markers across the convergence loop.
- Convergence loop in `runPipeline`: after the initial sweep the loop-marked phases (`inline-unify`, `inline-samekeys`, `inline-equivalent`, `structural-dedupe`) re-run until quiescent, bound by `pipeline.convergence-cap` (default 4); on cap-hit a warning is printed to stderr.
- `inline-equivalent` pass (`src/passes/inline-equivalent.ts`): collapses two object IRs that render to byte-identical TypeScript (via `dryRender`) into a single canonical reference, even when their internal IR shapes differ.
- `hoist-shared` pass (`src/passes/hoist-shared.ts`): any object IR with ≥`hoist-shared.min-refs` parent references and ≥`hoist-shared.min-keys` keys becomes a named decl, eliminating duplicate inline bodies in emitted output. Runs after `structural-dedupe` as a final mop-up; pure name-addition so not loop-eligible.
- Naming-plugin system in `src/plugins/`: `NamePlugin` interface with optional `match(ir, ctx)` and `contribute()` hooks; `apply-plugins` phase walks the IR and renames matched objects, optionally hoisting them. `collectContributions(plugins)` merges multi-tag/dedup/record hints + parameter overrides across the chain (set-dedup for hints, last-wins for parameters).
- Bundled `vscodePlugin`: maps the VSCode `$mid` discriminator table to semantic names (`VscodeUri`, `VscodeLanguageModelTextPart`, etc.) and contributes `$mid` as a multi-tag hint, copilot-chat dedup hints, and the `UserSelectedTools` record hint. `--no-plugins` CLI flag for explicit disable.
- Per-target plugin selection in the manifest via `options.plugins: string[]` (resolved against `BUILTIN_PLUGINS` by `resolvePluginNames`); JSON schema validates names against the known built-in enum. Demo manifest now sets `codex` to `plugins: []` and `copilot-chat` to `plugins: ["vscode"]`.
- Configurable pipeline parameters (`src/parameters.ts`): single flat namespace `<pass>.<param>` (kebab-case) with `DEFAULT_PARAMETERS`, validating `mergeParameters`, and `parseParameterPair` for CLI. Five tunables: `hoist-shared.min-keys` (2), `hoist-shared.min-refs` (2), `pipeline.convergence-cap` (4), `structural-dedupe.max-passes` (16), `check.failure-cap` (20). Precedence: CLI `--param key=value` (repeatable on `gen`/`check`/`simplify`) > manifest `options.parameters` > plugin `contribute().parameters` > defaults.
- `CheckOptions { failureCap }` threaded through `checkRecords`, `mergeReport`, and `checkJsonlAgainstDts` so the failure cap is no longer a hard-coded `20`.
- `agents.md` § Parameters table documenting all tunables and the precedence order.

### Changed
- Manifest plugin semantics: omitting `target.options.plugins` now means *no plugins* (opt-in), not "use defaults". CLI mode with no manifest still falls back to `DEFAULT_PLUGINS`. **Migration**: existing manifests that relied on implicit defaults must add `"plugins": ["vscode"]` (or whatever they want) explicitly.
- `applyHoistShared(root, hoistedSet, params)` and `applyStructuralDedupe(root, rootName, extra, maxPasses)` signatures now take their thresholds explicitly instead of module-level constants; pipeline wrappers source them from the resolved `Parameters`.
- `collectContributions` validates plugin parameter contributions via `mergeParameters` and rewraps errors with the offending plugin's name.
- `examples/copilot-chat.d.ts` regenerated: 4 anonymous `$mid_N_<hash>` decls renamed to semantic `Vscode*` names by the bundled plugin; `examples/codex.d.ts` unchanged (its target opts out).

## [0.1.3] - 2026-05-11

### Changed
- Release workflow switched to npm Trusted Publishing (OIDC). The `publish` job no longer uses an `NPM_TOKEN` secret; it requests a GitHub OIDC token via `id-token: write`, and the npm CLI exchanges it for a short-lived publish credential. Provenance is still attested. Operators must configure a Trusted Publisher on npmjs.com for the `schema-extractor` package (publisher: GitHub Actions, repo: `clouds56-hello/schema-extractor`, workflow: `release.yml`, environment: `npm`) before the workflow can publish.
- Workflows upgraded to current action majors and Node 24: `actions/checkout@v6`, `actions/setup-node@v6` with `node-version: '24'`. Node 24 ships npm 11.x with built-in OIDC trusted-publishing support, removing the need to upgrade npm separately on the runner.

## [0.1.2] - 2026-05-11

### Added
- Build pipeline (`scripts/build.ts` + `tsconfig.build.json`): bundles each public entrypoint with `Bun.build` (target: `bun`, format: `esm`) into `dist/` with `@/*` aliases resolved at build time, then emits `.d.ts` declarations via `tsc` and rewrites alias paths in declarations via `tsc-alias`. Bin (`dist/bin/schema-extractor.js`) preserves its `#!/usr/bin/env bun` shebang and is marked executable. Triggered by `bun run build` and automatically by `prepublishOnly`.
- `.github/workflows/release.yml`: publishes the package to npm with `--access public --provenance` when a `v*` tag is pushed. A `verify` job runs `bun run ci` first; the `publish` job depends on it, runs under the `npm` GitHub Environment (so `NPM_TOKEN` is environment-scoped and any protection rules apply), and refuses to publish unless the tag matches `package.json` version.
- `package.json` now points `main` / `module` / `types` / `exports` / `bin` at `dist/`, drops `src` and `bin` from `files` (replaced by `dist`).

### Changed
- `package.json` `repository` / `homepage` / `bugs` URLs updated to match the actual git remote (`github.com/clouds56-hello/schema-extractor`).
- Copilot-chat sample input path moved from `~/.local/share/workspaceStorage/*/chatSessions/*.jsonl` to the canonical VSCode location `~/.config/Code/User/workspaceStorage/*/chatSessions/*.jsonl` in `schema-extractor.json`, the integration test, and the docs. Re-run `bun run regen:examples` once that path is populated to refresh `examples/copilot-chat.d.ts`.

### Fixed
- Release workflow trigger: switched from `workflow_run` on CI completion to a direct `push: tags: ['v*']` trigger. The previous design never fired because `github.event.workflow_run.head_branch` reports the underlying branch of the tagged commit (`main`), not the tag ref (`v0.1.1`), so the `startsWith(head_branch, 'v')` gate could never match. Tag-driven publish now works end-to-end. As a consequence `v0.1.1` was tagged but never published to npm; this release ships as `0.1.2`.

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
