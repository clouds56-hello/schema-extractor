import type { Adapter } from "./adapters/index"
import { DEFAULT_ADAPTERS } from "./adapters/index"
import { ALIASES, type AliasDef } from "./ir/alias"
import { DEFAULT_PARAMETERS, mergeParameters, type Parameters } from "./parameters"
import { collectContributions, DEFAULT_PLUGINS, type NamePlugin, type RecordHint } from "./plugins/index"

export interface ExtractorOptions {
  /** Root type name in emitted .d.ts. Default: `"Root"`. */
  rootName?: string
  /** Extra discriminator key beyond TAG_CANDIDATES. */
  userTagKey?: string | null
  /** `[scopePrefix, namePrefix]` IR-merge hints (Phase 1a). */
  dedupHints?: ReadonlyArray<readonly [string, string]>
  /** Field/path segment names that force record collapse. */
  recordHints?: readonly RecordHint[]
  /** Tag keys for global shape consolidation (Phase 1b'). */
  multiTagHints?: readonly string[]
  /** Adapter chain. Defaults to all built-ins; pass `[]` to disable. */
  adapters?: readonly Adapter[]
  /** Naming/hoisting plugins. Defaults to all built-ins; pass `[]` to disable. */
  plugins?: readonly NamePlugin[]
  /** Extra string aliases, tried before built-in aliases. */
  stringAliases?: readonly AliasDef[]
  /** Pipeline parameter overrides; merged onto DEFAULT_PARAMETERS. See src/parameters.ts. */
  parameters?: Readonly<Record<string, number>>
  /** Override the file header comment. */
  header?: string
}

export interface ResolvedOptions {
  rootName: string
  userTagKey: string | null
  dedupHints: ReadonlyArray<readonly [string, string]>
  recordHints: readonly RecordHint[]
  multiTagHints: readonly string[]
  adapters: readonly Adapter[]
  plugins: readonly NamePlugin[]
  stringAliases: readonly AliasDef[]
  parameters: Parameters
  header: string | undefined
}

// Domain-agnostic core defaults. Project-specific knowledge (e.g. VSCode's
// `$mid` marshalling discriminator, copilot-chat decl naming) lives in the
// bundled plugins — see `src/plugins/vscode.ts`. Users opting out via
// `plugins: []` get a clean baseline.
const DEFAULT_DEDUP_HINTS: ReadonlyArray<readonly [string, string]> = []
const DEFAULT_RECORD_HINTS: readonly RecordHint[] = []
const DEFAULT_MULTI_TAG_HINTS: readonly string[] = []

export function resolveOptions(opts: ExtractorOptions = {}): ResolvedOptions {
  const plugins = opts.plugins ?? DEFAULT_PLUGINS
  const contrib = collectContributions(plugins)
  // Parameter precedence: defaults < plugin contributions < explicit user opts.
  const withPluginParams = mergeParameters(DEFAULT_PARAMETERS, contrib.parameters)
  const parameters = mergeParameters(withPluginParams, opts.parameters)
  const stringAliases = mergeStringAliases([...(opts.stringAliases ?? []), ...contrib.stringAliases, ...ALIASES])
  return {
    rootName: opts.rootName ?? "Root",
    userTagKey: opts.userTagKey ?? null,
    // Plugin contributions and explicit user options are concatenated.
    // Explicit-option entries take precedence by appearing later (later
    // hint-dedup passes resolve duplicates idempotently).
    dedupHints: [...contrib.dedupHints, ...(opts.dedupHints ?? DEFAULT_DEDUP_HINTS)],
    recordHints: [...contrib.recordHints, ...(opts.recordHints ?? DEFAULT_RECORD_HINTS)],
    multiTagHints: [...contrib.multiTagHints, ...(opts.multiTagHints ?? DEFAULT_MULTI_TAG_HINTS)],
    adapters: opts.adapters ?? DEFAULT_ADAPTERS,
    plugins,
    stringAliases,
    parameters,
    header: opts.header,
  }
}

function mergeStringAliases(aliases: readonly AliasDef[]): readonly AliasDef[] {
  const seen = new Set<string>()
  const out: AliasDef[] = []
  for (const alias of aliases) {
    if (seen.has(alias.name)) continue
    seen.add(alias.name)
    out.push(alias)
  }
  return out
}
