# agents.md — guide for AI coding agents working on schema-extractor

This file is the orientation map. Read it before touching code.

## Reading order
1. **`goal.md`** — what we're building and why.
2. **This file** — architecture + conventions.
3. **`src/index.ts`** — public API surface; the rest is implementation detail.
4. **`old/extract-jsonl-schema.ts`** — the original monolithic reference (excluded from the package via `.gitignore`). Useful when behavior questions arise; **do not import from it and do not modify it**.

## Architecture (one screen)

```
src/
├── ir/               # Intermediate Representation (pure data + merge)
│   ├── types.ts      # Schema discriminated union, Prim, NEVER
│   ├── alias.ts      # AliasDef registry; detectKeyAlias; isPathLike
│   ├── from-value.ts # JSON value → IR
│   └── merge.ts      # core merge, mergeIntoUnion, mergeObjects, pickTag*
│
├── policy/           # Composable rules for "may these two IRs unify?"
│   ├── types.ts      # MergePolicy, GateKind, SimilarKind, PickerKind
│   ├── gates.ts      # gateAccepts (tag-strict, no-tag, …)
│   ├── similar.ts    # similarAccepts (same-keys, subset-keys, types-match, …)
│   ├── pickers.ts    # pickCanonIndex (first, shortest-name, most-fields, …)
│   ├── combine.ts    # combineInto + mergeDeepSafe + mergeGroup
│   └── presets.ts    # STREAM_*, HINT_*, AUTO_RECURSIVE_*, INLINE_*, TAG_HINT_*
│
├── passes/           # Whole-IR transformation phases
│   ├── recordify.ts          # alias-keyed objects → Record<K,V>
│   ├── hint-dedup.ts         # DEDUP_HINTS-driven manual dedup
│   ├── auto-recursive.ts     # detect & collapse recursive shapes
│   ├── tag-hints.ts          # MULTI_TAG_HINTS ($mid, …) global consolidation
│   ├── field-tag.ts          # field-scoped (parentField, tagKey, tagValue) consolidation
│   ├── inline-unify.ts       # phase 1c: inline ↔ hoisted unification
│   ├── inline-samekeys.ts    # phase 1d: untagged same-keys consolidation
│   ├── rewrite.ts            # rewriteIR helper (apply canonicalFor map)
│   └── pipeline.ts           # composes the phases in the documented order
│
├── emit/             # IR → TypeScript text
│   ├── name.ts       # PathCtx, pascal, sha8, variantTypeName, descenders
│   ├── render.ts     # render(), renderObjectInline(), needsParens(), dryRender()
│   ├── hoist.ts      # collectHoists, namePrefixOf, HoistMeta, cycleSplice
│   ├── dedupe.ts     # dedupeDecls (structural identical-body collapse)
│   └── document.ts   # final document layout: header + alias preamble + decls + root
│
├── input/            # I/O at the edge
│   ├── stream.ts     # streaming line reader, gzip decompress
│   ├── glob.ts       # ~ + ** + glob expansion via Bun.Glob
│   └── jsonl.ts      # JSONL ingest using a configured AdapterRegistry
│
├── adapters/         # Pluggable input-shape replayers
│   ├── types.ts      # InputAdapter interface (detect + replay)
│   ├── vscode-patch.ts   # full port of maybeReplayVscodePatchJsonl
│   └── codex-rollout.ts  # stub adapter (identity); demonstrates the slot
│
├── runtime.ts        # process-level mutable config (e.g. USER_TAG_KEY)
├── config.ts         # ExtractorOptions + defaults
├── index.ts          # public API: extractSchema(), extractSchemaFromFiles(), types
└── cli.ts            # argv parsing, stdin/file orchestration

bin/schema-extractor.ts   # thin shebang wrapper → src/cli.ts
```

### Why this split
- **`ir/`** is "what does the data look like, structurally?" — pure value-mapping and unification.
- **`policy/`** is "under what conditions do we treat two IRs as the same thing?" — declarative rule sets composed from gates + similarity + pickers + combine kinds. Shared by every pass.
- **`passes/`** is "specific high-level transforms" — each one calls into `policy/` with its own preset. New behaviors land here.
- **`emit/`** is rendering only; it never mutates IR semantics (cycleSplice mutates *references* during hoisting, never types).
- **`input/`** + **`adapters/`** are the only places allowed to do I/O.

### Pipeline (canonical order, see `passes/pipeline.ts`)
```
1. recordify              — alias-keyed objects → Record
2. hint-dedup             — DEDUP_HINTS
3. auto-recursive         — recursive (field, tagKey, tagValue)
4. field-tag              — same (parentField, tagKey, tagValue), non-recursive
5. tag-hints              — MULTI_TAG_HINTS ($mid, …)
6. inline-unify           — inline ↔ hoisted, then inline-only
7. inline-samekeys        — untagged identical key sets
8. (render)               — collectHoists + emit named decls
9. dedupeDecls            — structural identical-body collapse
```
Reordering breaks fixtures. If you must change the order, update the pipeline test under `tests/golden/cases/` first.

## Conventions

### Code
- TS, ESM, Bun-native. No build step.
- **No semicolons.** Biome enforces `semicolons: "asNeeded"`. Lines that begin with `[ ( \` + - /` get a leading `;` (ASI prefix-semi convention).
- **Imports**: cross-folder uses the `@/` path alias (resolves to `src/`); same-folder siblings use `./name`. Outside `src/` (bin, scripts, tests) always use `@/`. Never include `.js` or `.ts` in import specifiers.
- Prefer `interface` for record types, `type` for unions / aliases.
- Discriminated unions use `k:` (kept short because it shows up everywhere in the IR).
- No silent catches: surface parse errors via `console.error` with `[source:line]` prefix.
- No mutation of input IRs across module boundaries except inside `passes/` (where the doc strings explicitly mention canonical-rewriting). `merge()` and `from-value()` allocate fresh IRs.
- **Tooling**: `bun run format` (write), `bun run lint` (check only), `bun run check` (format + lint + safe fixes).

### Commits
- **Conventional Commits**: `<type>(optional-scope)!: <subject>`. Enforced by the `commit-msg` hook in `.githooks/` (active via `core.hooksPath`).
- **Allowed types**: `feat` (new behavior), `fix` (bug), `chore` (tooling/deps), `test`, `docs`, `refactor` (no behavior change), `style` (formatting only), `perf`, `build`, `ci`, `revert`.
- **Scope** is optional and lowercase: `feat(adapters): …`, `fix(ir): …`. Use a top-level `src/` folder name or a high-level concept.
- **Subject**: imperative mood, lowercase, ≤ 72 chars, no trailing period.
- **Body** (optional): blank line, then wrapped ~72 cols. Explain *why*, not *what*.
- **Authorship**: use the global `git config user.name` / `user.email` — never override per-commit.

### Testing
- **Run**: `bun test`
- **Update goldens**: `UPDATE_GOLDEN=1 bun test`
- **Add a regression case**: drop `tests/golden/cases/<name>/input.jsonl` (and optionally `options.json`); run with `UPDATE_GOLDEN=1` once; commit the produced `expected.d.ts`.
- **Unit tests** for any pure helper live in `tests/unit/<topic>.test.ts`.
- **E2E** tests against the user's real `~/.codex/sessions` and `~/.local/share/workspaceStorage` are opt-in and self-skip when those directories are absent.

### Examples
- `bun run regen:examples` rebuilds `examples/codex.d.ts` and `examples/copilot-chat.d.ts` from the live sample directories. Commit the result.
- The examples double as a real-world smoke test; if regen blows up, fix it before shipping changes to passes/ or emit/.

### Adding a new adapter
1. Implement `InputAdapter` in `src/adapters/<name>.ts`.
2. Export it from `src/adapters/index.ts`.
3. Add it to `defaultAdapters` in `src/config.ts` if it should be on by default, OR document the opt-in in the README.
4. Add a golden case under `tests/golden/cases/adapter-<name>/`.

### Adding a new pass
1. Implement `(root, opts) => { canonicalFor, newHoists?, hoistNames? }` in `src/passes/<name>.ts`.
2. Slot it into `passes/pipeline.ts` at the correct position with a comment explaining why.
3. Add at least one golden fixture demonstrating the change.

### Adding a new alias
1. Append a new `AliasDef` to `ALIASES` in `src/ir/alias.ts` in priority order (most specific first).
2. Update the alias preamble logic if the alias needs special rendering (most don't).
3. Add a unit test under `tests/unit/alias.test.ts`.

## Things to avoid
- Importing from `old/`. It's a reference, not a dependency.
- Adding npm runtime dependencies. Bun + Node built-ins only.
- Putting business logic into `cli.ts`. Parse args, then delegate to the API.
- Mutating `ALIASES` or any preset MergePolicy at runtime; copy and override instead.
- Catching exceptions silently in passes; if a transform aborts, leave a `console.error` breadcrumb so users can re-run with smaller inputs to bisect.
