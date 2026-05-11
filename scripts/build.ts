/**
 * Build script: produces a Bun-targeted ESM `dist/` from `src/` + `bin/`.
 *
 * Layout produced:
 *   dist/index.js                    library main
 *   dist/cli.js                      programmatic CLI entry
 *   dist/adapters/vscode-patch.js    subpath adapter
 *   dist/adapters/codex-rollout.js   subpath adapter
 *   dist/bin/schema-extractor.js     CLI binary (with #!/usr/bin/env bun, +x)
 *   dist/**\/*.d.ts                  type declarations (tsc) with @/* aliases
 *                                    rewritten to relative paths via tsc-alias
 *
 * Bundles are produced with `Bun.build` (target: bun, format: esm) so `@/*`
 * tsconfig path aliases are resolved at build time and the published package
 * has no runtime dependency on the alias mapping.
 */
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const DIST = join(ROOT, "dist")

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (status ${r.status})`)
  }
}

interface Entry {
  entrypoint: string
  outDir: string
  bin?: boolean
}

const ENTRIES: Entry[] = [
  { entrypoint: "src/index.ts", outDir: DIST },
  { entrypoint: "src/cli.ts", outDir: DIST },
  { entrypoint: "src/adapters/vscode-patch.ts", outDir: join(DIST, "adapters") },
  { entrypoint: "src/adapters/codex-rollout.ts", outDir: join(DIST, "adapters") },
  { entrypoint: "bin/schema-extractor.ts", outDir: join(DIST, "bin"), bin: true },
]

async function buildBundles(): Promise<void> {
  for (const e of ENTRIES) {
    mkdirSync(e.outDir, { recursive: true })
    const result = await Bun.build({
      entrypoints: [join(ROOT, e.entrypoint)],
      outdir: e.outDir,
      target: "bun",
      format: "esm",
      splitting: false,
      sourcemap: "external",
    })
    if (!result.success) {
      for (const log of result.logs) console.error(log)
      throw new Error(`bun build failed for ${e.entrypoint}`)
    }
    if (e.bin) {
      for (const out of result.outputs) {
        chmodSync(out.path, 0o755)
      }
    }
  }
}

function buildDeclarations(): void {
  // tsc emits .d.ts mirroring src/ into dist/, then tsc-alias rewrites
  // any @/* imports inside the declarations to relative paths.
  run("bunx", ["tsc", "-p", "tsconfig.build.json"])
  run("bunx", ["tsc-alias", "-p", "tsconfig.build.json"])
}

function copyBinDeclarations(): void {
  // tsconfig.build.json's rootDir is `src`, so `bin/schema-extractor.ts`
  // is excluded from declaration emit (it's an executable, not a typed
  // import surface). Nothing to do here today; placeholder for future.
}

async function main(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST, { recursive: true })

  console.log("[build] bundling with bun build")
  await buildBundles()

  console.log("[build] emitting type declarations with tsc + tsc-alias")
  buildDeclarations()
  copyBinDeclarations()

  // Sanity-check that the headline files exist.
  const expected = [
    "index.js",
    "index.d.ts",
    "cli.js",
    "cli.d.ts",
    "adapters/vscode-patch.js",
    "adapters/vscode-patch.d.ts",
    "adapters/codex-rollout.js",
    "adapters/codex-rollout.d.ts",
    "bin/schema-extractor.js",
  ]
  const missing = expected.filter((p) => !existsSync(join(DIST, p)))
  if (missing.length > 0) {
    throw new Error(`build produced incomplete dist; missing: ${missing.join(", ")}`)
  }

  // Verify the bin shebang made it through (bun build sometimes drops banners
  // when the entrypoint already starts with one).
  const binPath = join(DIST, "bin", "schema-extractor.js")
  const binSrc = readFileSync(binPath, "utf8")
  if (!binSrc.startsWith("#!/usr/bin/env bun")) {
    writeFileSync(binPath, `#!/usr/bin/env bun\n${binSrc}`)
    chmodSync(binPath, 0o755)
  }

  console.log(`[build] dist ready at ${DIST}`)
}

await main()

// Suppress unused-import warning in environments where `dirname` is not used
// directly (kept in scope in case future entries need it).
void dirname
